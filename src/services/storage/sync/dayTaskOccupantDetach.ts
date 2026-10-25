import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import {
  buildSpecialistHandoffIdentity,
  buildSpecialistHandoffTargets,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { findDetachedReviewEdits } from '@/services/repositories/conflictResolutionDetachedEdits';
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
  /** Detached note text, also offered as drafts in the handoff view. */
  notes?: SpecialistHandoffSyncPayload;
}

const IDENTITY_FIELDS = new Set(['patientName', 'rut', 'documentType', 'clinicalEpisodeId']);
const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
const HELD_KEY = /^daily:[^:]+:detached:/;
type Target = { bedId: string; target: 'bed' | 'clinicalCrib' };

/** The bed or crib a field path edits; whole values and bed slot fields follow the merge. */
const fieldTarget = (path: string): (Target & { field: string }) | null => {
  const [root, bedId, field, nested] = path.split('.');
  if (root !== 'beds' || !bedId || !field || BED_SLOT_FIELDS.has(field)) return null;
  if (field !== 'clinicalCrib') return { bedId, target: 'bed', field };
  return nested ? { bedId, target: 'clinicalCrib', field: nested } : null;
};
/** The bed or crib any bed path, whole or not, belongs to. */
const slotOf = (path: string): Target => {
  const [, bedId, field] = path.split('.');
  return { bedId, target: field === 'clinicalCrib' ? 'clinicalCrib' : 'bed' };
};
const occupantOf = (record: DailyRecord, { bedId, target }: Target): PatientData | undefined =>
  target === 'clinicalCrib' ? record.beds?.[bedId]?.clinicalCrib : record.beds?.[bedId];
const heldMessage = (record: DailyRecord, group: Target) => {
  const occupant = occupantOf(record, group);
  return `La ${group.target === 'clinicalCrib' ? 'cuna' : 'cama'} ${group.bedId} ya no tiene a ${
    buildSpecialistHandoffIdentity(occupant).patientName || 'este paciente'
  }${
    // An identity under review may not prove it either way.
    occupant?.identityReview ? ', o no se puede confirmar' : ''
  }. Sus cambios no se publicaron y se conservan para revisión.`;
};
const valuesIn = (source: DailyRecord, paths: string[]) =>
  Object.fromEntries(paths.map(path => [path, getValueAtPath(source, path)]));

/**
 * The edits of `task` at `paths`, kept as one conflict per bed or crib, bound to the patient each
 * had in `record`, the payload the edits were written on. Notes are also offered as drafts.
 */
const holdOccupantEdits = (
  task: SyncTask,
  record: DailyRecord,
  paths: string[]
): Pick<DetachedOccupantWork, 'conflicts' | 'notes'> => {
  const groups = new Map<string, Target & { paths: string[] }>();
  for (const path of paths) {
    const slot = slotOf(path);
    const id = `${slot.bedId}.${slot.target}`;
    groups.set(id, { ...slot, paths: [...(groups.get(id)?.paths ?? []), path] });
  }
  // Its own mutation id: the day task's publish never acknowledges the held edits.
  const { mutationIds: _compacted, ...contract } = task.syncContract ?? {};
  const notePaths = paths.filter(path => /\.medicalHandoff(?:Note|Entries|Audit)$/.test(path));
  return {
    conflicts: [...groups.values()].map(group => {
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
    notes: notePaths.length
      ? {
          date: record.date,
          patch: valuesIn(record, notePaths),
          expectedOccupants: buildSpecialistHandoffTargets(record, valuesIn(record, notePaths)),
        }
      : undefined,
  };
};

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
  if (!stale.length) return null;
  // A held conflict retried while its patient is still gone stays that same conflict.
  if (HELD_KEY.test(task.key ?? ''))
    throw new ConcurrencyError(heldMessage(record, stale[0]), 'semantic_conflict');
  const detached = stale.flatMap(group => group.paths);
  return {
    task: {
      ...task,
      syncContract: {
        ...task.syncContract,
        changedPaths: changedPaths.filter(path => !detached.includes(path)),
      },
    },
    record: applyPatches(record, valuesIn(remote, detached) as DailyRecordPatch),
    ...holdOccupantEdits(task, record, detached),
  };
};

/**
 * After the merge of `task`: the edits it left out in a bed or crib whose identity is under review
 * and whose stored copy is not that same patient (an identity edit included). They join the edits
 * `work` already detached, as the same kind of conflict; the merged day never writes them.
 */
export const holdReviewedOccupantEdits = (
  task: SyncTask,
  record: DailyRecord,
  remote: DailyRecord,
  merged: DailyRecord,
  work: DetachedOccupantWork | null | undefined
): DetachedOccupantWork | undefined => {
  const published = work ?? { task, record };
  const paths = findDetachedReviewEdits(
    remote,
    published.record,
    merged,
    published.task.syncContract?.changedPaths ?? []
  );
  if (!paths.length) return work ?? undefined;
  if (HELD_KEY.test(task.key ?? ''))
    throw new ConcurrencyError(heldMessage(record, slotOf(paths[0])), 'semantic_conflict');
  const held = work?.conflicts.flatMap(conflict => conflict.syncContract?.changedPaths ?? []);
  return { ...published, ...holdOccupantEdits(task, record, [...(held ?? []), ...paths]) };
};
