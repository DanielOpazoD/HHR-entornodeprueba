/**
 * Replay guards for a day task whose version looks current: its copy must match the stored day
 * outside its own changes. Loaded with the outbox, on demand, off the authenticated shell.
 */
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import { hasSameBedOccupant } from '@/services/storage/sync/bedOccupantIdentity';
import {
  getValueAtPath,
  hasSameComparableValue,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

/** Fields a specialist note writes on a patient; its own task publishes them. */
const NOTE_FIELDS = [
  'medicalHandoffEntries',
  'medicalHandoffNote',
  'medicalHandoffAudit',
  'clinicalEvents',
] as const;

/** A legacy or whole-record write does not say which paths it owns: it keeps writing it all. */
const ownedPaths = (task: SyncTask): string[] | null => {
  const changed = normalizeChangedPaths(task.syncContract?.changedPaths);
  return changed.length && !changed.includes('*') ? changed : null;
};

const touches = (changed: string[], path: string): boolean =>
  changed.some(changedPath => pathsOverlap(changedPath, path));

/**
 * A copy whose version is the stored day's holds the same patients in every bed it did not touch.
 * Another patient or episode there means its version is not that day's (a note shown only on this
 * device used to move it): the task then merges by its changed paths instead of writing it all.
 */
export const hasOtherOccupantInUntouchedBed = (
  task: SyncTask,
  local: DailyRecord,
  remote: DailyRecord
): boolean => {
  const changed = ownedPaths(task);
  return Boolean(
    changed &&
    Object.keys({ ...remote.beds, ...local.beds }).some(
      bedId =>
        !touches(changed, `beds.${bedId}`) &&
        (!hasSameBedOccupant(local.beds?.[bedId], remote.beds?.[bedId]) ||
          !hasSameBedOccupant(
            local.beds?.[bedId]?.clinicalCrib,
            remote.beds?.[bedId]?.clinicalCrib
          ))
    )
  );
};

/**
 * A day write never publishes a note it did not write: note fields outside its changed paths keep
 * the stored day's values, whether this device still holds a pending note there or a refused one.
 */
export const keepStoredNoteFields = (
  task: SyncTask,
  local: DailyRecord,
  remote: DailyRecord
): DailyRecord => {
  const changed = ownedPaths(task);
  if (!changed) return local;
  const stored: Record<string, unknown> = {};
  for (const [bedId, bed] of Object.entries(local.beds ?? {})) {
    const targets = [`beds.${bedId}`, ...(bed?.clinicalCrib ? [`beds.${bedId}.clinicalCrib`] : [])];
    for (const path of targets.flatMap(target => NOTE_FIELDS.map(field => `${target}.${field}`))) {
      const value = getValueAtPath(remote, path);
      if (!touches(changed, path) && !hasSameComparableValue(getValueAtPath(local, path), value))
        stored[path] = value;
    }
  }
  return Object.keys(stored).length ? applyPatches(local, stored as DailyRecordPatch) : local;
};
