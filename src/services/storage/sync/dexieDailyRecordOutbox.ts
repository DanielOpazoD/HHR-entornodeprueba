import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  findReusableSyncTask,
  listUnresolvedDailyRecordTasks,
  matchesOwner,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';
import {
  buildDailyRecordSyncContract,
  mergeSyncTaskContracts,
} from '@/services/storage/sync/syncTaskContractPolicy';

/**
 * A day's pending truth is its local projection plus the unresolved write that holds it. A write
 * computed from another base must land on top of that projection: its changed paths take its
 * values and every other pending path keeps the value another accepted write gave it.
 * The outbox store loads this module on demand, so it stays off the authenticated startup shell.
 */

/** Returns the write applied on the pending projection, or null when it already carries it. */
type PendingProjectionRebase = (pending: {
  projection: DailyRecord;
  pendingChangedPaths: string[];
}) => DailyRecord | null;

// Same mergeable roots as the publish-time same-path check (firestoreSyncConflictPolicy).
const MOVEMENT_LOG_PATHS = new Set(['discharges', 'transfers', 'cma']);
const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
const BED_FIELD_PATH = /^beds\.([^.]+)\.([^.]+)/;

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

/** A legacy or whole-record write does not say which paths it owns. */
const isOpaqueChangedPaths = (paths: readonly string[]): boolean =>
  paths.length === 0 || paths.includes('*');

const carriesProjectionValuesAt = (
  source: DailyRecord,
  projection: DailyRecord,
  paths: readonly string[]
): boolean =>
  paths.every(path =>
    hasSameComparableValue(getValueAtPath(source, path), getValueAtPath(projection, path))
  );

const hasIdentity = (patient: PatientData | undefined): boolean =>
  Boolean(
    patient &&
    [patient.clinicalEpisodeId, patient.rut, patient.patientName].some(value =>
      String(value ?? '').trim()
    )
  );

const documentOf = (patient: PatientData): string =>
  `${patient.documentType ?? 'RUT'}:${String(patient.rut ?? '')
    .trim()
    .toUpperCase()}`;

/** Both slots empty, or the same patient and episode. A RUT never matches a passport. */
const hasSameOccupant = (
  left: PatientData | undefined,
  right: PatientData | undefined
): boolean => {
  if (!hasIdentity(left) && !hasIdentity(right)) return true;
  return Boolean(
    left &&
    right &&
    hasIdentity(left) &&
    hasIdentity(right) &&
    hasSamePatientEpisodeIdentity(left, right) &&
    documentOf(left) === documentOf(right)
  );
};

/** A field edit belongs to the occupant it was written for; a whole-bed value compares by value. */
const assertSameOccupantAtPath = (
  path: string,
  writtenFor: DailyRecord,
  projection: DailyRecord
): void => {
  const match = BED_FIELD_PATH.exec(path);
  if (!match || BED_SLOT_FIELDS.has(match[2])) return;
  const [, bedId, field] = match;
  const writtenBed = writtenFor.beds?.[bedId];
  const projectedBed = projection.beds?.[bedId];
  if (
    hasSameOccupant(writtenBed, projectedBed) &&
    (field !== 'clinicalCrib' ||
      hasSameOccupant(writtenBed?.clinicalCrib, projectedBed?.clinicalCrib))
  ) {
    return;
  }
  throw new ConcurrencyError(
    'La cama o la cuna cambió de paciente en otra pestaña. Recargue el censo antes de continuar.'
  );
};

/** Movement logs are bitácoras by id: both writes keep their entries. */
const mergeMovementLogValue = (
  path: string,
  value: unknown,
  projected: unknown
): unknown[] | null =>
  MOVEMENT_LOG_PATHS.has(path) && Array.isArray(value) && Array.isArray(projected)
    ? mergeMovementArrayById(projected, value, true)
    : null;

/**
 * Default for a record queued without its base (a retry or an auto-merge of a write that already
 * reached the outbox): its changed paths are that write's latest intent.
 */
const buildRecordOverlayRebase = (
  record: DailyRecord,
  changedPaths: readonly string[] | undefined
): PendingProjectionRebase | undefined => {
  const ownPaths = (changedPaths ?? []).filter(Boolean);
  if (isOpaqueChangedPaths(ownPaths)) return undefined;
  return ({ projection, pendingChangedPaths }) => {
    const otherPendingPaths = pendingChangedPaths.filter(
      pendingPath => !ownPaths.some(ownPath => pathsOverlap(ownPath, pendingPath))
    );
    if (
      record.lastUpdated === projection.lastUpdated ||
      (!isOpaqueChangedPaths(pendingChangedPaths) &&
        carriesProjectionValuesAt(record, projection, otherPendingPaths))
    ) {
      return null;
    }
    const patch: DailyRecordPatch = {};
    ownPaths.forEach(path => {
      assertSameOccupantAtPath(path, record, projection);
      const value = getValueAtPath(record, path);
      patch[path] = mergeMovementLogValue(path, value, getValueAtPath(projection, path)) ?? value;
    });
    return { ...applyPatches(projection, patch), lastUpdated: record.lastUpdated };
  };
};

/**
 * A new patch and the record it was computed from. When another accepted write already changed
 * the day's pending projection (another tab, or a read that showed an older copy), the patch is
 * prepared again on top of that projection. A path both writes changed follows the conflict
 * policy, not last-write-wins: movement logs merge by id, anything else is rejected.
 */
const buildPatchRebase =
  ({ baseRecord, patch, prepare }: DailyRecordPatchWrite): PendingProjectionRebase =>
  ({ projection, pendingChangedPaths }) => {
    if (baseRecord.lastUpdated === projection.lastUpdated) return null;
    // Compare with the base as it would have been stored: saving drops empty staffing slots and
    // derives bed fields, so a tab's own optimistic copy must not read as another tab's change.
    const storedBase = prepare(baseRecord, {});
    if (
      !isOpaqueChangedPaths(pendingChangedPaths) &&
      carriesProjectionValuesAt(storedBase, projection, pendingChangedPaths)
    ) {
      return null;
    }

    const rebasedPatch: DailyRecordPatch = {};
    Object.entries(patch).forEach(([path, value]) => {
      assertSameOccupantAtPath(path, storedBase, projection);
      const projected = getValueAtPath(projection, path);
      if (
        hasSameComparableValue(getValueAtPath(storedBase, path), projected) ||
        hasSameComparableValue(value, projected)
      ) {
        rebasedPatch[path] = value;
        return;
      }
      const merged = mergeMovementLogValue(path, value, projected);
      if (!merged) {
        throw new ConcurrencyError(
          'Otra pestaña cambió el mismo dato del censo. Recargue el censo antes de continuar.'
        );
      }
      rebasedPatch[path] = merged;
    });
    return prepare(projection, rebasedPatch);
  };

/**
 * The outbox task one write leaves for the day. When an unresolved write still holds the stored
 * projection as its payload, the write lands on that projection and keeps that write's remote base.
 */
const foldWriteIntoOutbox = ({
  task,
  existing,
  stored,
  unresolved,
  rebase,
}: {
  task: SyncTask;
  existing: SyncTask | null;
  stored: DailyRecord | undefined;
  unresolved: SyncTask[];
  rebase: PendingProjectionRebase | undefined;
}): SyncTask => {
  const owner =
    stored &&
    unresolved.find(
      candidate =>
        (candidate.payload as Partial<DailyRecord> | null | undefined)?.lastUpdated ===
        stored.lastUpdated
    );
  const rebased =
    owner && rebase
      ? rebase({
          projection: stored,
          pendingChangedPaths: owner.syncContract?.changedPaths ?? [],
        })
      : null;
  const merged = mergeSyncTaskContracts(existing?.syncContract, task.syncContract);
  return rebased && owner
    ? {
        ...task,
        payload: rebased,
        syncContract: buildDailyRecordSyncContract(rebased, {
          ...merged,
          expectedVersion: owner.syncContract?.expectedVersion ?? merged?.expectedVersion,
          baseRevision: owner.syncContract?.baseRevision,
        }),
      }
    : { ...task, syncContract: merged };
};

/** Writes the day's record and its outbox task in one transaction. */
export const saveDailyRecordInOutbox = (
  record: DailyRecord,
  task: SyncTask,
  patchWrite?: DailyRecordPatchWrite
): Promise<{ mode: 'created' | 'reused'; persistedRecord: DailyRecord }> => {
  const rebase = patchWrite
    ? buildPatchRebase(patchWrite)
    : buildRecordOverlayRebase(record, task.syncContract?.changedPaths);
  return hospitalDB
    .transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
      const existing = task.key
        ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
        : null;
      const nextTask = foldWriteIntoOutbox({
        task,
        existing,
        rebase,
        stored: await hospitalDB.dailyRecords.get(record.date),
        unresolved: (await listUnresolvedDailyRecordTasks(record.date)).filter(
          candidate =>
            candidate.type === task.type && matchesOwner(task.ownerKey, candidate.ownerKey)
        ),
      });
      const persistedRecord = nextTask.payload as DailyRecord;
      await hospitalDB.dailyRecords.put(persistedRecord);
      if (existing?.id) {
        await hospitalDB.syncQueue.put({ ...existing, ...nextTask, id: existing.id });
        return { mode: 'reused' as const, persistedRecord };
      }
      await hospitalDB.syncQueue.add(nextTask);
      return { mode: 'created' as const, persistedRecord };
    })
    .catch(error => {
      // A refused stale write leaves nothing behind; the caller gets the conflict.
      if (error instanceof ConcurrencyError) {
        recordOperationalTelemetry({
          category: 'sync',
          operation: 'sync_queue_task_conflict',
          status: 'degraded',
          runtimeState: 'recoverable',
          issues: [error.message],
          context: {
            type: task.type,
            date: record.date,
            contexts: task.contexts,
            origin: task.origin,
          },
        });
      }
      throw error;
    });
};
