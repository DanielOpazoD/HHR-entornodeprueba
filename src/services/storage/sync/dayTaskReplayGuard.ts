/**
 * Replay guards for a day task whose version looks current: its copy must match the stored day
 * outside its own changes. Loaded with the outbox, on demand, off the authenticated shell.
 */
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import { hasSameBedOccupant } from '@/services/storage/sync/bedOccupantIdentity';
import {
  getValueAtPath,
  hasSameComparableValue,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';

export const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

/** Note fields on a patient: a day write publishes only the ones it changed. */
export const NOTE_FIELDS = [
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
 * the stored day's values. A whole-record write names no paths and writes the day it holds.
 */
export const keepStoredNoteFields = (
  task: SyncTask,
  local: DailyRecord,
  remote: DailyRecord | undefined
): DailyRecord => {
  const changed = ownedPaths(task);
  if (!changed) return local;
  const stored: Record<string, unknown> = {};
  for (const [bedId, bed] of Object.entries(local.beds ?? {})) {
    const targets = [`beds.${bedId}`, ...(bed?.clinicalCrib ? [`beds.${bedId}.clinicalCrib`] : [])];
    for (const path of targets.flatMap(target => NOTE_FIELDS.map(field => `${target}.${field}`))) {
      const value = getValueAtPath(local, path);
      const storedValue = getValueAtPath(remote, path);
      if (hasSameNoteValue(value, storedValue)) continue;
      if (!changed.some(changedPath => pathsOverlap(changedPath, path))) stored[path] = storedValue;
    }
  }
  return Object.keys(stored).length ? applyPatches(local, stored as DailyRecordPatch) : local;
};

const IDENTITY_FIELDS = new Set(['patientName', 'rut', 'documentType', 'clinicalEpisodeId']);
const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
type SlotTarget = { bedId: string; target: 'bed' | 'clinicalCrib' };

const bedFieldTarget = (path: string): (SlotTarget & { field: string }) | null => {
  const [root, bedId, field, nested] = path.split('.');
  if (root !== 'beds' || !bedId || !field || BED_SLOT_FIELDS.has(field)) return null;
  if (field !== 'clinicalCrib') return { bedId, target: 'bed', field };
  return nested ? { bedId, target: 'clinicalCrib', field: nested } : null;
};

const slotOccupant = (
  record: DailyRecord,
  { bedId, target }: SlotTarget
): PatientData | undefined =>
  target === 'clinicalCrib' ? record.beds?.[bedId]?.clinicalCrib : record.beds?.[bedId];

export interface StrippedOccupantWork {
  /** The day task without the stale occupant paths, and its payload restored from remote there. */
  task: SyncTask;
  record: DailyRecord;
}

/**
 * Field edits belong to the occupant they were written for (ID-01, ID-05). When the stored bed or
 * crib now holds another patient or episode, those stale field paths are stripped and restored
 * from remote so they never land on the new occupant, without creating `:detached:` sub-tasks.
 * A task that itself changed occupant identity (admission, discharge, correction) keeps normal
 * merge/conflict handling.
 */
export const stripStaleOccupantPaths = (
  task: SyncTask,
  record: DailyRecord,
  remote: DailyRecord
): StrippedOccupantWork | null => {
  const changedPaths = task.syncContract?.changedPaths ?? [];
  const groups = new Map<string, SlotTarget & { paths: string[]; changesOccupant: boolean }>();
  for (const path of changedPaths) {
    const target = bedFieldTarget(path);
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
      !hasSameBedOccupant(slotOccupant(record, group), slotOccupant(remote, group))
  );
  if (!stale.length) return null;
  const stripped = stale.flatMap(group => group.paths);
  const remoteValues = Object.fromEntries(
    stripped.map(path => [path, getValueAtPath(remote, path)])
  );
  return {
    task: {
      ...task,
      syncContract: {
        ...task.syncContract,
        changedPaths: changedPaths.filter(path => !stripped.includes(path)),
      },
    },
    record: applyPatches(record, remoteValues as DailyRecordPatch),
  };
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
