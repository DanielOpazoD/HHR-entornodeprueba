import { useCallback, MutableRefObject } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import {
  buildAtomicPatientMovementPatch,
  type AtomicPatientMovementListKey,
} from '@/application/census/public';

interface UsePatientMovementMutationExecutorParams {
  recordRef: MutableRefObject<DailyRecord | null>;
  saveAndUpdate: PersistDailyRecord;
  patchRecord?: ApplyDailyRecordPatch;
  movementKey?: AtomicPatientMovementListKey;
}

export const usePatientMovementMutationExecutor = ({
  recordRef,
  saveAndUpdate,
  patchRecord,
  movementKey,
}: UsePatientMovementMutationExecutorParams) => {
  return useCallback(
    async (mutation: (record: DailyRecord) => DailyRecord): Promise<void> => {
      const record = recordRef.current;
      if (!record) {
        return;
      }

      const updatedRecord = mutation(record);
      if (patchRecord && movementKey) {
        await patchRecord(
          buildAtomicPatientMovementPatch({
            updatedRecord,
            movementKey,
            sourceBedIds: [],
          })
        );
        return;
      }

      await saveAndUpdate(updatedRecord);
    },
    [movementKey, patchRecord, recordRef, saveAndUpdate]
  );
};
