import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';

import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';

/** One indexed read for daily holders and specialist notes, including sparse date batches. */
export const listRecordAdmissionTasks = (dates: string[]): Promise<SyncTask[]> => {
  const sorted = [...dates].sort();
  return hospitalDB.syncQueue
    .where('key')
    .inAnyRange([
      [`daily:${sorted[0]}`, `daily:${sorted.at(-1)}\0`],
      [`handoff:${sorted[0]}:`, `handoff:${sorted.at(-1)}:\uffff`],
    ])
    .toArray();
};

/** Only a proven patient/episode and unchanged note base may receive pending note fields. */
export const projectPendingSpecialistHandoffs = (
  record: DailyRecord,
  tasks: SyncTask[],
  remoteRecord: DailyRecord = record
): DailyRecord => {
  let projected = record;
  for (const task of tasks) {
    if (
      task.type !== 'UPDATE_SPECIALIST_HANDOFF' ||
      !['PENDING', 'PROCESSING'].includes(task.status) ||
      task.projectionReleased ||
      !task.handoffProjection ||
      task.handoffProjection.released
    )
      continue;
    const payload = task.payload as SpecialistHandoffSyncPayload;
    if (payload.date !== record.date || !payload.expectedOccupants?.length) continue;
    const patch: DailyRecordPatch = {};
    for (const [path, value] of Object.entries(task.handoffProjection?.projected ?? {})) {
      if (/^beds\.[^.]+\.(clinicalCrib\.)?medicalHandoff(Note|Entries|Audit)$/.test(path))
        patch[path] = value;
    }
    if (!Object.keys(patch).length) continue;
    const targets = buildSpecialistHandoffTargets(remoteRecord, patch);
    const next = applyPatches(remoteRecord, patch);
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
    ) {
      if (remoteRecord === record) continue;
      projected = applyPatches(
        projected,
        Object.fromEntries(
          // Paths were restricted above to the typed note fields of this DailyRecord.
          Object.keys(patch).map(path => [path, getValueAtPath(remoteRecord, path)])
        ) as DailyRecordPatch
      );
    } else projected = applyPatches(projected, patch);
  }
  return projected;
};
