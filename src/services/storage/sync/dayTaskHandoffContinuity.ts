import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';

export interface DetachedHandoffNotes {
  task: SyncTask;
  record: DailyRecord;
  notes: SpecialistHandoffSyncPayload;
}

/**
 * A day task can still carry a note typed before the deploy, or by another role, for a patient
 * who has since left that bed or crib. The day's other edits publish as usual; those note paths
 * keep the stored values, and their text goes to the drafts of the patient it was typed for.
 * Loaded only for day tasks that carry note paths.
 */
export const detachChangedOccupantNotes = (
  task: SyncTask,
  record: DailyRecord,
  remote: DailyRecord
): DetachedHandoffNotes | null => {
  const changedPaths = task.syncContract?.changedPaths ?? [];
  const detached = changedPaths.filter(path => {
    if (!/\.medicalHandoff(?:Note|Entries|Audit)$/.test(path)) return false;
    const [queued] = buildSpecialistHandoffTargets(record, { [path]: null });
    const [stored] = buildSpecialistHandoffTargets(remote, { [path]: null });
    return Boolean(queued && stored && !sameSpecialistHandoffTarget(queued, stored));
  });
  if (!detached.length) return null;
  const valuesFrom = (source: DailyRecord) =>
    Object.fromEntries(detached.map(path => [path, getValueAtPath(source, path)]));
  return {
    task: {
      ...task,
      syncContract: {
        ...task.syncContract,
        changedPaths: changedPaths.filter(path => !detached.includes(path)),
      },
    },
    record: applyPatches(record, valuesFrom(remote)),
    notes: {
      date: record.date,
      patch: valuesFrom(record),
      expectedOccupants: buildSpecialistHandoffTargets(record, valuesFrom(record)),
    },
  };
};
