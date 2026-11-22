import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { buildSpecialistHandoffIdentity } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { hasSameBedOccupant } from './bedOccupantIdentity';
import { clearSyncTaskRuntimeState } from './syncQueueTaskFactory';

export interface DetachedOccupantWork {
  /** The day task without the detached paths, and its payload with the stored values there. */
  task: SyncTask;
  record: DailyRecord;
  /** One preserved conflict per bed or crib, bound to the patient its edits were written for. */
  conflicts: SyncTask[];
}

const IDENTITY_FIELDS = new Set(['patientName', 'rut', 'documentType', 'clinicalEpisodeId']);
const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
type Target = { bedId: string; target: 'bed' | 'clinicalCrib' };

/** The bed or crib a field path edits; whole values and bed slot fields follow the merge. */
const fieldTarget = (path: string): (Target & { field: string }) | null => {
  const [root, bedId, field, nested] = path.split('.');
  if (root !== 'beds' || !bedId || !field || BED_SLOT_FIELDS.has(field)) return null;
  if (field !== 'clinicalCrib') return { bedId, target: 'bed', field };
  return nested ? { bedId, target: 'clinicalCrib', field: nested } : null;
};
const occupantOf = (record: DailyRecord, { bedId, target }: Target): PatientData | undefined =>
  target === 'clinicalCrib' ? record.beds?.[bedId]?.clinicalCrib : record.beds?.[bedId];
const heldMessage = (record: DailyRecord, group: Target) =>
  `La ${group.target === 'clinicalCrib' ? 'cuna' : 'cama'} ${group.bedId} ya no tiene a ${
    buildSpecialistHandoffIdentity(occupantOf(record, group)).patientName || 'este paciente'
  }. Sus cambios no se publicaron y se conservan para revisión.`;

/**
 * Field edits belong to the occupant they were written for. When the stored bed or crib now
 * holds another patient or episode, none of that target's edits are written to it: they leave
 * the day task as one conflict bound to the original patient, and the store writes that conflict
 * in the same transaction that completes the task. Other beds publish as usual. A task that
 * itself changed the occupant (admission, discharge, correction) keeps the normal merge policy.
 */
export const detachStaleOccupantPaths = (
  task: SyncTask,
  record: DailyRecord,
  remote: DailyRecord
): DetachedOccupantWork | null => {
  const changedPaths = task.syncContract?.changedPaths ?? [];
  const groups = new Map<string, Target & { paths: string[]; changesOccupant: boolean }>();
  for (const path of changedPaths) {
    const target = fieldTarget(path);
    if (!target) continue;
    const id = `${target.bedId}.${target.target}`;
    const group = groups.get(id) ?? { ...target, paths: [], changesOccupant: false };
    group.paths.push(path);
    group.changesOccupant ||= IDENTITY_FIELDS.has(target.field);
    groups.set(id, group);
  }
  const stale = [...groups.values()].filter(
    group =>
      !group.changesOccupant &&
      !hasSameBedOccupant(occupantOf(record, group), occupantOf(remote, group))
  );
  const firstStale = stale[0];
  if (!firstStale) return null;
  // A held conflict retried while its patient is still gone stays that same conflict.
  if (/^daily:[^:]+:detached:/.test(task.key ?? ''))
    throw new ConcurrencyError(heldMessage(record, firstStale), 'semantic_conflict');
  const detached = stale.flatMap(group => group.paths);
  // Its own mutation id: the day task's publish never acknowledges the held edits.
  const { mutationIds: _compacted, ...contract } = task.syncContract ?? {};
  const valuesIn = (source: DailyRecord, paths: string[]) =>
    Object.fromEntries(paths.map(path => [path, getValueAtPath(source, path)]));
  return {
    task: {
      ...task,
      syncContract: {
        ...task.syncContract,
        changedPaths: changedPaths.filter(path => !detached.includes(path)),
      },
    },
    record: applyPatches(record, valuesIn(remote, detached) as DailyRecordPatch),
    conflicts: stale.map(group => {
      const identity = buildSpecialistHandoffIdentity(occupantOf(record, group));
      const key = `daily:${record.date}:detached:${task.id ?? task.opId}:${JSON.stringify([
        group.bedId,
        group.target,
        identity.documentType,
        identity.rut,
        identity.patientName,
        identity.clinicalEpisodeId,
      ])}`;
      return {
        ...task,
        ...clearSyncTaskRuntimeState(),
        id: undefined,
        opId: `UPDATE_DAILY_RECORD:${key}`,
        key,
        payload: record,
        status: 'CONFLICT',
        syncContract: {
          ...contract,
          changedPaths: group.paths,
          mutationId: `${contract.mutationId ?? task.opId}:detached:${group.bedId}.${group.target}`,
        },
        error: heldMessage(record, group),
        lastErrorCode: 'occupant_changed',
        lastErrorCategory: 'conflict',
        lastErrorAt: Date.now(),
      };
    }),
  };
};

/** Writes edits held for a patient no longer in their bed, one conflict per bed or crib. */
export const keepDetachedConflicts = async (
  db: typeof hospitalDB,
  conflicts: SyncTask[],
  ownerKey: string | undefined
) => {
  for (const conflict of conflicts) {
    const existing = conflict.key
      ? await db.syncQueue.where('key').equals(conflict.key).first()
      : undefined;
    if (existing?.id) await db.syncQueue.put({ ...conflict, id: existing.id });
    else await db.syncQueue.add({ ...conflict, ownerKey });
  }
};

const isEmptySlot = (slot: PatientData | undefined) => hasSameBedOccupant(slot, undefined);

/**
 * The stored day with only the beds and cribs that `next` empties taken from it: what a discharge
 * or transfer leaves, without counting an identity correction as another patient.
 */
export const withVacatedSlots = (stored: DailyRecord, next: DailyRecord): DailyRecord => ({
  ...stored,
  beds: Object.fromEntries(
    Object.entries(stored.beds ?? {}).map(([bedId, bed]) => {
      const nextBed = next.beds?.[bedId];
      const kept = isEmptySlot(nextBed) ? nextBed : bed;
      return [
        bedId,
        {
          ...kept,
          clinicalCrib: isEmptySlot(nextBed?.clinicalCrib)
            ? nextBed?.clinicalCrib
            : bed?.clinicalCrib,
        } as PatientData,
      ];
    })
  ),
});
