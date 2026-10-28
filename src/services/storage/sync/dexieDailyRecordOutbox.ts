import {
  assertFullSaveNoteBase,
  assertPendingFullSaveBase,
  assertSameOccupantAtPath,
  hasSamePatchBaseValue,
  localProjectionIds,
  staleDailyRecordError,
} from '@/services/storage/sync/fullSaveNoteBaseGuard';
import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import type { PatientData } from '@/types/domain/patient';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
  specialistHandoffTextState,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
// The replay-time occupant checks ship with the enqueue-time one, in this lazy chunk.
export { detachStaleOccupantPaths } from '@/services/storage/sync/dayTaskOccupantDetach';
export {
  hasOtherOccupantInUntouchedBed,
  keepStoredNoteFields,
} from '@/services/storage/sync/dayTaskReplayGuard';
import {
  hasSameNoteValue,
  type SpecialistNoteValue,
} from '@/services/storage/sync/dayTaskReplayGuard';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { UNKNOWN_SERVER_VERSION } from '@/services/storage/sync/syncTaskContractPolicy';
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

/** A detached note's text is also offered as drafts in the handoff view. */
export const publishDetachedNotes = async (notes: SpecialistHandoffSyncPayload) =>
  (await import('@/services/storage/medicalHandoffDraftStorage')).publishSpecialistHandoffConflict(
    notes
  );

/**
 * A day's pending truth is its local projection plus the unresolved write that holds it. A write
 * computed from another base must land on top of that projection: its changed paths take its
 * values and every other pending path keeps the value another accepted write gave it.
 * The outbox store loads this module on demand, so it stays off the authenticated startup shell.
 */

type PendingProjectionRebase = (projection: DailyRecord, pendingPaths: string[]) => DailyRecord;

// Same mergeable roots as the publish-time same-path check (firestoreSyncConflictPolicy).
const MOVEMENT_LOG_PATHS = new Set(['discharges', 'transfers', 'cma']);

/** A legacy or whole-record write does not say which paths it owns. */
const isOpaqueChangedPaths = (paths: readonly string[]): boolean =>
  paths.length === 0 || paths.includes('*');

/** Journals keep concurrent ids; a Rayen entry changes only against its writer's base. */
const mergeJournalValue = (
  path: string,
  value: unknown,
  projected: unknown,
  base?: unknown
): unknown[] | null => {
  if (
    path === 'rayenSyncHistory' &&
    Array.isArray(value) &&
    (projected == null || Array.isArray(projected))
  ) {
    const current = projected as DailyRecord['rayenSyncHistory'];
    const currentById = new Map((current ?? []).map(event => [event.id, event]));
    const baseById = new Map(
      (Array.isArray(base) ? (base as RayenSyncEvent[]) : []).map(event => [event.id, event])
    );
    const incomingById = new Map((value as RayenSyncEvent[]).map(event => [event.id, event]));
    const changed = Array.from(incomingById.values()).filter(event => {
      const previous = baseById.get(event.id);
      if (hasSameComparableValue(event, previous)) return false;
      const stored = currentById.get(event.id);
      if (!hasSameComparableValue(stored, previous) && !hasSameComparableValue(stored, event)) {
        throw staleDailyRecordError('Otra pestaña cambió esta corrida Rayen');
      }
      return true;
    });
    return mergeRayenSyncHistory(current, changed);
  }
  return MOVEMENT_LOG_PATHS.has(path) && Array.isArray(value) && Array.isArray(projected)
    ? mergeMovementArrayById(projected, value, true)
    : null;
};

/**
 * Default for a record queued without its base (a retry or an auto-merge of a write that already
 * reached the outbox): its changed paths are that write's latest intent.
 */
const buildRecordOverlayRebase = (
  record: DailyRecord,
  changedPaths: readonly string[] | undefined,
  isRemoteMerge: boolean
): PendingProjectionRebase | undefined => {
  const ownPaths = (changedPaths ?? []).filter(Boolean);
  if (isOpaqueChangedPaths(ownPaths)) return undefined;
  return (projection, pendingPaths) => {
    let base = projection;
    if (isRemoteMerge) {
      // This record already resolved a remote conflict. Retain remote fields except
      // where an unresolved accepted write explicitly owns a pending local value.
      if (pendingPaths.includes('*')) {
        throw new ConcurrencyError(
          'No se puede reconciliar una escritura pendiente sin sus rutas.'
        );
      }
      const pendingPatch: DailyRecordPatch = {};
      pendingPaths.forEach(path => {
        assertSameOccupantAtPath(path, projection, record);
        const value = getValueAtPath(projection, path);
        pendingPatch[path] = mergeJournalValue(path, value, getValueAtPath(record, path)) ?? value;
      });
      base = applyPatches(record, pendingPatch);
    }
    const patch: DailyRecordPatch = {};
    ownPaths.forEach(path => {
      assertSameOccupantAtPath(path, record, projection);
      const value = getValueAtPath(record, path);
      patch[path] = mergeJournalValue(path, value, getValueAtPath(base, path)) ?? value;
    });
    return { ...applyPatches(base, patch), lastUpdated: record.lastUpdated };
  };
};

/**
 * A new patch and the record it was computed from. When another accepted write already changed
 * the day's pending projection (another tab, or a read that showed an older copy), the patch is
 * prepared again on top of that projection. A path both writes changed follows the conflict
 * policy, not last-write-wins: append-only journals merge by id, anything else is rejected.
 */
const buildPatchRebase =
  ({ baseRecord, patch, prepare }: DailyRecordPatchWrite): PendingProjectionRebase =>
  projection => {
    // Normalize the optimistic base just as persistence does before comparing its values.
    const storedBase = prepare(baseRecord, {});
    const storedProjection = prepare(projection, {});
    const rebasedPatch: DailyRecordPatch = {};
    Object.entries(patch).forEach(([path, value]) => {
      assertSameOccupantAtPath(path, storedBase, storedProjection);
      const projected = getValueAtPath(storedProjection, path);
      if (
        hasSamePatchBaseValue(getValueAtPath(storedBase, path), projected) ||
        hasSameComparableValue(value, projected)
      ) {
        rebasedPatch[path] = value;
        return;
      }
      const merged = mergeJournalValue(path, value, projected, getValueAtPath(storedBase, path));
      if (!merged) {
        throw staleDailyRecordError('Otra pestaña cambió este dato');
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
  wholeRecordBase,
}: {
  task: SyncTask;
  existing: SyncTask | null;
  stored: DailyRecord | undefined;
  unresolved: SyncTask[];
  rebase: PendingProjectionRebase | undefined;
  wholeRecordBase?: DailyRecord;
}): SyncTask => {
  const owner = unresolved.find(
    candidate => stored && hasSameComparableValue(candidate.payload, stored)
  );
  // A published replacement has no pending task, but its content and patient still own the day.
  const pendingPaths = Array.from(
    new Set(
      unresolved.flatMap(candidate =>
        candidate.syncContract?.changedPaths?.length ? candidate.syncContract.changedPaths : ['*']
      )
    )
  );
  if (!rebase) {
    assertPendingFullSaveBase({
      incoming: task.payload as DailyRecord,
      pending: unresolved,
      base: wholeRecordBase,
    });
  }
  const rebased = stored && rebase ? rebase(stored, pendingPaths) : null;
  const merged = mergeSyncTaskContracts(existing?.syncContract, task.syncContract);
  const payload = rebased ?? (task.payload as DailyRecord);
  const baseContract = existing?.syncContract ?? owner?.syncContract;
  return {
    ...task,
    payload,
    localProjectionBaseIds: [...localProjectionIds(owner)],
    syncContract: {
      ...buildDailyRecordSyncContract(payload, merged),
      // A local edit is not a publication. Compaction keeps the unresolved remote base,
      // including an absent revision, even when the next write already carries the projection.
      ...(baseContract
        ? {
            expectedVersion: baseContract.expectedVersion,
            baseRevision: baseContract.baseRevision,
          }
        : {}),
    },
  };
};

/**
 * A note write folded into a pending one keeps every stored text it may replace: the first
 * edit's base, and the texts this device already sent for that note, since one of them may have
 * landed without its answer.
 */
const mergeHandoffBases = (
  previous: SpecialistHandoffSyncPayload,
  next: SpecialistHandoffSyncPayload
): SpecialistHandoffSyncPayload => ({
  ...next,
  expectedOccupants: next.expectedOccupants.map(target => {
    const before = previous.expectedOccupants.find(
      item => item.bedId === target.bedId && item.target === target.target
    );
    if (!before?.handoffBases || !target.handoffBases) return target;
    const path = `beds.${target.bedId}${target.target === 'clinicalCrib' ? '.clinicalCrib' : ''}`;
    const sent =
      `${path}.medicalHandoffNote` in previous.patch &&
      `${path}.medicalHandoffEntries` in previous.patch
        ? [
            specialistHandoffTextState({
              medicalHandoffNote: previous.patch[`${path}.medicalHandoffNote`] as string,
              medicalHandoffEntries: previous.patch[
                `${path}.medicalHandoffEntries`
              ] as PatientData['medicalHandoffEntries'],
            }),
          ]
        : [];
    const [first, ...rest] = [
      ...new Set([...before.handoffBases, ...sent, ...target.handoffBases]),
    ];
    return { ...target, handoffBases: [first, ...rest.slice(-7)] };
  }),
});

const handoffPaths = (task: SyncTask) =>
  Object.keys((task.payload as SpecialistHandoffSyncPayload).patch).filter(
    path => path !== 'dateTimestamp'
  );

/**
 * A specialist note is its own task, not a day write. Its projection lands on the stored day by
 * the same stale-base rules, but never changes a projection a pending day task still holds.
 * It publishes nothing, so the day keeps the version it was read at: no later write or read takes
 * a note shown only on this device for a version of the server's day. The task keeps what the
 * projection replaced, so a note that can no longer publish leaves the day as it was.
 */
const saveSpecialistHandoffInOutbox = (
  record: DailyRecord,
  task: SyncTask,
  patchWrite?: DailyRecordPatchWrite
) =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const stored = await hospitalDB.dailyRecords.get(record.date);
    const before = stored ?? patchWrite?.baseRecord ?? record;
    const projection = {
      ...(stored && patchWrite ? buildPatchRebase(patchWrite)(stored, []) : record),
      lastUpdated: before.lastUpdated,
    };
    const projected = !(await listUnresolvedDailyRecordTasks(record.date)).length;
    const persistedRecord = projected ? projection : (stored ?? record);
    if (projected) await hospitalDB.dailyRecords.put(projection);
    const existing = task.key
      ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
      : null;
    const paths = handoffPaths(task);
    const heldValues = Object.fromEntries(paths.map(path => [path, getValueAtPath(before, path)]));
    // A pending edit of this note already projected; a refused one gave its values back.
    const pendingProjection =
      existing?.status === 'PENDING' ? existing.handoffProjection : undefined;
    const handoffProjection = projected
      ? {
          replaced: {
            ...heldValues,
            ...pendingProjection?.replaced,
          },
          projected: Object.fromEntries(
            paths.map(path => [path, getValueAtPath(projection, path)])
          ),
        }
      : pendingProjection && Object.keys(pendingProjection.projected).length
        ? pendingProjection
        : // The day already owns its projection. Remember its note values without changing them,
          // so a later successful note ACK can replace that stale copy before the day retries.
          { replaced: heldValues, projected: heldValues };
    const nextTask = {
      ...task,
      payload: existing
        ? mergeHandoffBases(
            existing.payload as SpecialistHandoffSyncPayload,
            task.payload as SpecialistHandoffSyncPayload
          )
        : task.payload,
      syncContract: mergeSyncTaskContracts(existing?.syncContract, task.syncContract),
      handoffProjection,
    };
    if (existing?.id) {
      await hospitalDB.syncQueue.put({ ...existing, ...nextTask, id: existing.id });
      return { mode: 'reused' as const, persistedRecord };
    }
    await hospitalDB.syncQueue.add(nextTask);
    return { mode: 'created' as const, persistedRecord };
  });

const noteTasksFor = async (date: string) =>
  (await hospitalDB.syncQueue.where('key').startsWith(`handoff:${date}:`).toArray()).filter(
    task => task.type === 'UPDATE_SPECIALIST_HANDOFF' && task.status !== 'RETIRED'
  );

/** Both the current note and its older projection still belong to the note task. */
export const listSpecialistNoteValues = async (
  date: string
): Promise<Map<string, SpecialistNoteValue[]>> => {
  const values = new Map<string, SpecialistNoteValue[]>();
  for (const task of await noteTasksFor(date)) {
    const payload = task.payload as SpecialistHandoffSyncPayload;
    const projected = task.handoffProjection?.projected ?? {};
    for (const path of new Set([...handoffPaths(task), ...Object.keys(projected)])) {
      const [, bedId, field] = path.split('.');
      const target = payload.expectedOccupants.find(
        occupant =>
          occupant.bedId === bedId &&
          occupant.target === (field === 'clinicalCrib' ? 'clinicalCrib' : 'bed')
      );
      if (!target?.clinicalEpisodeId || !target.patientName) continue;
      values.set(path, [
        ...(values.get(path) ?? []),
        { target, value: payload.patch[path] },
        ...(path in projected ? [{ target, value: projected[path] }] : []),
      ]);
    }
  }
  return values;
};

/** A legacy note has no recorded values to restore. */
const RELEASED = { replaced: {}, projected: {} };

/**
 * A note that can no longer publish (refused, failed or discarded) stops shaping the day. Where the
 * stored day, or a day write folded on top of it, still shows what the note projected, those fields
 * go back to what it replaced, and a later note projected over it now replaces those values; the
 * text stays in the note's task and drafts. A note queued before this rule recorded nothing, and
 * its projection may have moved the day's version: the day then counts as older than any server
 * version, so the next read takes the server's day, and a day write queued meanwhile merges by
 * its changed paths. A confirmed note instead settles its old projection to the values just
 * published, in the ACK transaction, so a queued day never writes the old note back afterward.
 * Returns whether the stored day changed.
 */
const settleSpecialistHandoffProjection = (task: SyncTask, confirmed: boolean): Promise<boolean> =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const { date } = task.payload as SpecialistHandoffSyncPayload;
    const projection = task.handoffProjection;
    const stored = await hospitalDB.dailyRecords.get(date);
    const dayTasks = (await listUnresolvedDailyRecordTasks(date)).filter(dayTask => dayTask.id);
    if (!confirmed && projection?.released) return false;
    if (task.id && !confirmed)
      await hospitalDB.syncQueue.update(task.id, {
        handoffProjection: projection ? { ...projection, released: true } : RELEASED,
      });
    if (!projection) {
      for (const dayTask of dayTasks)
        await hospitalDB.syncQueue.update(dayTask.id!, {
          syncContract: { ...dayTask.syncContract, expectedVersion: UNKNOWN_SERVER_VERSION },
        });
      if (!stored) return false;
      await hospitalDB.dailyRecords.put({ ...stored, lastUpdated: UNKNOWN_SERVER_VERSION });
      return true;
    }
    const shows = (value: unknown, path: string) =>
      hasSameNoteValue(value, projection.projected[path]) ||
      (confirmed &&
        Boolean(projection.released) &&
        hasSameNoteValue(value, projection.replaced[path]));
    const replacement = confirmed
      ? Object.fromEntries(
          handoffPaths(task).map(path => [
            path,
            (task.payload as SpecialistHandoffSyncPayload).patch[path],
          ])
        )
      : projection.replaced;
    const ownsPath = (path: string, targets: SpecialistHandoffSyncPayload['expectedOccupants']) => {
      const [, bedId, field] = path.split('.');
      const expected = (task.payload as SpecialistHandoffSyncPayload).expectedOccupants.find(
        target =>
          target.bedId === bedId &&
          target.target === (field === 'clinicalCrib' ? 'clinicalCrib' : 'bed')
      );
      return Boolean(
        expected?.clinicalEpisodeId &&
        expected.patientName &&
        targets.some(target => sameSpecialistHandoffTarget(target, expected))
      );
    };
    for (const other of await noteTasksFor(date)) {
      const replaced = other.id !== task.id ? other.handoffProjection?.replaced : undefined;
      const targets = (other.payload as SpecialistHandoffSyncPayload).expectedOccupants;
      const matches = (value: unknown, path: string) =>
        ownsPath(path, targets) && shows(value, path);
      if (!replaced || !Object.entries(replaced).some(([path, value]) => matches(value, path)))
        continue;
      await hospitalDB.syncQueue.update(other.id!, {
        handoffProjection: {
          ...other.handoffProjection!,
          replaced: Object.fromEntries(
            Object.entries(replaced).map(([path, value]) => [
              path,
              matches(value, path) && path in replacement ? replacement[path] : value,
            ])
          ),
        },
      });
    }
    const restore = (day: DailyRecord): DailyRecord | null => {
      const targets = buildSpecialistHandoffTargets(day, replacement);
      const restored = Object.fromEntries(
        Object.entries(replacement).filter(
          ([path]) =>
            path in projection.projected &&
            ownsPath(path, targets) &&
            shows(getValueAtPath(day, path), path)
        )
      );
      return Object.keys(restored).length
        ? { ...applyPatches(day, restored as DailyRecordPatch), lastUpdated: day.lastUpdated }
        : null;
    };
    const day = stored && restore(stored);
    if (day) await hospitalDB.dailyRecords.put(day);
    for (const dayTask of dayTasks) {
      const payload = restore(dayTask.payload as DailyRecord);
      if (payload) await hospitalDB.syncQueue.update(dayTask.id!, { payload });
    }
    return Boolean(day);
  });

export const releaseSpecialistHandoffProjection = (task: SyncTask): Promise<boolean> =>
  settleSpecialistHandoffProjection(task, false);

export const confirmSpecialistHandoffProjection = (task: SyncTask): Promise<boolean> =>
  settleSpecialistHandoffProjection(task, true);

/** Repair legacy projections and retry any quarantined cleanup, before dispatching day tasks. */
export const reconcileSpecialistHandoffProjections = (): Promise<string[]> =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const notes = (
      await hospitalDB.syncQueue.where('type').equals('UPDATE_SPECIALIST_HANDOFF').toArray()
    ).filter(
      task =>
        task.status !== 'RETIRED' &&
        (!task.handoffProjection ||
          ((task.status === 'FAILED' || task.status === 'CONFLICT') &&
            !task.handoffProjection.released &&
            Object.keys(task.handoffProjection.projected).length > 0))
    );
    const changed: string[] = [];
    for (const task of notes)
      if (await releaseSpecialistHandoffProjection(task))
        changed.push((task.payload as SpecialistHandoffSyncPayload).date);
    return changed;
  });

/** Writes the day's record and its outbox task in one transaction. */
export const saveDailyRecordInOutbox = (
  record: DailyRecord,
  task: SyncTask,
  patchWrite?: DailyRecordPatchWrite,
  wholeRecordBase?: DailyRecord
): Promise<{ mode: 'created' | 'reused'; persistedRecord: DailyRecord }> => {
  if (task.type === 'UPDATE_SPECIALIST_HANDOFF')
    return saveSpecialistHandoffInOutbox(record, task, patchWrite);
  const rebase = patchWrite
    ? buildPatchRebase(patchWrite)
    : buildRecordOverlayRebase(
        record,
        task.syncContract?.changedPaths,
        task.origin === 'conflict_auto_merge'
      );
  return hospitalDB
    .transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
      const existing = task.key
        ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
        : null;
      const stored = await hospitalDB.dailyRecords.get(record.date);
      if (!patchWrite && isOpaqueChangedPaths(task.syncContract?.changedPaths ?? [])) {
        assertFullSaveNoteBase(record, stored, wholeRecordBase);
      }
      const nextTask = foldWriteIntoOutbox({
        task,
        existing,
        rebase,
        stored,
        wholeRecordBase,
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

/** A remote-first full save must validate its note base before reaching the network. */
export const assertWholeRecordNoteBase = (record: DailyRecord, base?: DailyRecord): Promise<void> =>
  hospitalDB.transaction('r', hospitalDB.dailyRecords, async () => {
    const stored = await hospitalDB.dailyRecords.get(record.date);
    assertFullSaveNoteBase(record, stored, base);
  });
