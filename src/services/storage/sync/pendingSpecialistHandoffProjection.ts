import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';

/** Indexed by date; callers read these tasks in the same transaction as the day. */
export const listPendingSpecialistHandoffs = (date: string): Promise<SyncTask[]> =>
  hospitalDB.syncQueue
    .where('key')
    .startsWith(`handoff:${date}:`)
    .filter(
      task =>
        task.type === 'UPDATE_SPECIALIST_HANDOFF' &&
        (task.status === 'PENDING' || task.status === 'PROCESSING') &&
        !task.projectionReleased &&
        Boolean(task.handoffProjection && !task.handoffProjection.released)
    )
    .toArray();

/** Only a proven patient/episode and unchanged note base may receive pending note fields. */
export const projectPendingSpecialistHandoffs = (
  record: DailyRecord,
  tasks: SyncTask[]
): DailyRecord => {
  let projected = record;
  for (const task of tasks) {
    const payload = task.payload as SpecialistHandoffSyncPayload;
    if (payload.date !== record.date || !payload.expectedOccupants?.length) continue;
    const patch: DailyRecordPatch = {};
    for (const [path, value] of Object.entries(task.handoffProjection?.projected ?? {})) {
      if (/^beds\.[^.]+\.(clinicalCrib\.)?medicalHandoff(Note|Entries|Audit)$/.test(path))
        patch[path] = value;
    }
    const targets = buildSpecialistHandoffTargets(projected, patch);
    const next = applyPatches(projected, patch);
    const nextTargets = buildSpecialistHandoffTargets(next, patch);
    if (
      !targets.length ||
      !targets.every(target => {
        const expected = payload.expectedOccupants.find(
          expected =>
            expected.clinicalEpisodeId &&
            expected.patientName &&
            sameSpecialistHandoffTarget(target, expected)
        );
        const state = target.handoffBases?.[0];
        return (
          expected?.handoffBases?.length &&
          state !== undefined &&
          (expected.handoffBases.includes(state) ||
            nextTargets.some(
              nextTarget =>
                sameSpecialistHandoffTarget(target, nextTarget) &&
                nextTarget.handoffBases?.[0] === state
            ))
        );
      })
    )
      continue;
    projected = next;
  }
  return projected;
};
