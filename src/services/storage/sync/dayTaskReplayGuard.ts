/**
 * Replay guards for a day task whose version looks current: its copy must match the stored day
 * outside its own changes. Loaded with the outbox, on demand, off the authenticated shell.
 */
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import type { SpecialistHandoffTarget } from '@/types/domain/specialistHandoffTarget';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';

import { hasSameBedOccupant } from '@/services/storage/sync/bedOccupantIdentity';
import {
  getValueAtPath,
  hasSameComparableValue,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';

export interface SpecialistNoteValue {
  target: SpecialistHandoffTarget;
  value: unknown;
}

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

/** Fields a specialist note writes on a patient; its own task publishes them. */
const NOTE_FIELDS = [
  'medicalHandoffEntries',
  'medicalHandoffNote',
  'medicalHandoffAudit',
  'clinicalEvents',
] as const;

/** Firestore stores an absent author as null, the editor leaves it out: the same note either way. */
const withoutEmptyMembers = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutEmptyMembers)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, member]) => member !== null && member !== undefined)
            .map(([key, member]) => [key, withoutEmptyMembers(member)])
        )
      : value;

export const hasSameNoteValue = (left: unknown, right: unknown): boolean =>
  hasSameComparableValue(withoutEmptyMembers(left), withoutEmptyMembers(right));

/** A legacy or whole-record write does not say which paths it owns: it keeps writing it all. */
const ownedPaths = (task: SyncTask): string[] | null => {
  const changed = normalizeChangedPaths(task.syncContract?.changedPaths);
  return changed.length && !changed.includes('*') ? changed : null;
};

/** The bed's patient and its crib's newborn are separate slots: a path touches one or both. */
const slotsOf = (bedId: string) => {
  const bed = `beds.${bedId}`;
  const crib = `${bed}.clinicalCrib`;
  return [
    {
      touchedBy: (path: string) =>
        pathsOverlap(path, bed) && path !== crib && !path.startsWith(`${crib}.`),
      occupant: (record: DailyRecord) => record.beds?.[bedId],
    },
    {
      touchedBy: (path: string) => pathsOverlap(path, crib),
      occupant: (record: DailyRecord): PatientData | undefined =>
        record.beds?.[bedId]?.clinicalCrib,
    },
  ];
};

/**
 * A copy whose version is the stored day's holds the same patient in every slot it did not touch,
 * the bed's patient and the crib's newborn alike. Another patient or episode there means its
 * version is not that day's: the task then merges by its changed paths, so that slot keeps the
 * stored day's values, while a touched slot whose patient left becomes that patient's conflict.
 */
export const hasOtherOccupantInUntouchedBed = (
  task: SyncTask,
  local: DailyRecord,
  remote: DailyRecord
): boolean => {
  const changed = ownedPaths(task);
  return Boolean(
    changed &&
    Object.keys({ ...remote.beds, ...local.beds }).some(bedId =>
      slotsOf(bedId).some(
        slot =>
          !changed.some(slot.touchedBy) &&
          !hasSameBedOccupant(slot.occupant(local), slot.occupant(remote))
      )
    )
  );
};

/**
 * A day write never publishes a note it did not write: note fields outside its changed paths keep
 * the stored day's values. A whole-record write names no paths, so a note field keeps the stored
 * value where the write holds exactly what a specialist note still queued for that day wants
 * there for that same patient and episode, pending or refused: that text is the note's own.
 */
export const keepStoredNoteFields = (
  task: SyncTask,
  local: DailyRecord,
  remote: DailyRecord | undefined,
  noteValues: ReadonlyMap<string, readonly SpecialistNoteValue[]> = new Map()
): DailyRecord => {
  const changed = ownedPaths(task);
  const stored: Record<string, unknown> = {};
  for (const [bedId, bed] of Object.entries(local.beds ?? {})) {
    const targets = [`beds.${bedId}`, ...(bed?.clinicalCrib ? [`beds.${bedId}.clinicalCrib`] : [])];
    for (const path of targets.flatMap(target => NOTE_FIELDS.map(field => `${target}.${field}`))) {
      const value = getValueAtPath(local, path);
      const storedValue = getValueAtPath(remote, path);
      if (hasSameNoteValue(value, storedValue)) continue;
      const notTheDayWrites = changed
        ? !changed.some(changedPath => pathsOverlap(changedPath, path))
        : (noteValues.get(path) ?? []).some(
            noteValue =>
              hasSameNoteValue(value, noteValue.value) &&
              buildSpecialistHandoffTargets(local, { [path]: value }).some(target =>
                sameSpecialistHandoffTarget(target, noteValue.target)
              )
          );
      if (notTheDayWrites) stored[path] = storedValue;
    }
  }
  return Object.keys(stored).length ? applyPatches(local, stored as DailyRecordPatch) : local;
};
