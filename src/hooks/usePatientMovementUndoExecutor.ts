import { useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import {
  buildAtomicPatientMovementPatch,
  type AtomicPatientMovementListKey,
  resolveUndoPatientMovement,
  UndoMovementKind,
  UndoPatientMovementErrorCode,
  UndoMovementDescriptor,
} from '@/application/census/public';

interface UndoApplyParams {
  record: DailyRecord;
  movementId: string;
  bedId: string;
  updatedBed: PatientData;
}

interface UsePatientMovementUndoExecutorParams {
  createEmptyPatient: (bedId: string) => PatientData;
  saveAndUpdate: PersistDailyRecord;
  patchRecord?: ApplyDailyRecordPatch;
  movementKey?: AtomicPatientMovementListKey;
  notifyUndoError: (
    kind: UndoMovementKind,
    code: UndoPatientMovementErrorCode,
    descriptor: { patientName: string; bedName: string }
  ) => void;
}

interface ExecuteUndoParams {
  kind: UndoMovementKind;
  movement: UndoMovementDescriptor | undefined;
  record: DailyRecord;
  applyUndoRecord: (params: UndoApplyParams) => DailyRecord;
  onSuccess?: (params: { movement: UndoMovementDescriptor; updatedBed: PatientData }) => void;
}

export const usePatientMovementUndoExecutor = ({
  createEmptyPatient,
  saveAndUpdate,
  patchRecord,
  movementKey,
  notifyUndoError,
}: UsePatientMovementUndoExecutorParams) => {
  return useCallback(
    async ({ kind, movement, record, applyUndoRecord, onSuccess }: ExecuteUndoParams) => {
      if (!movement?.originalData) {
        return;
      }

      const resolution = resolveUndoPatientMovement({
        bedData: record.beds[movement.bedId],
        bedId: movement.bedId,
        isNested: movement.isNested,
        originalData: movement.originalData,
        createEmptyPatient,
      });
      if (!resolution.ok) {
        notifyUndoError(kind, resolution.error.code, {
          patientName: movement.patientName,
          bedName: movement.bedName,
        });
        return;
      }

      const nextRecord = applyUndoRecord({
        record,
        movementId: movement.id,
        bedId: movement.bedId,
        updatedBed: resolution.value.updatedBed,
      });
      if (patchRecord && movementKey) {
        await patchRecord(
          buildAtomicPatientMovementPatch({
            updatedRecord: nextRecord,
            movementKey,
            sourceBedIds: [movement.bedId],
          })
        );
      } else {
        await saveAndUpdate(nextRecord);
      }

      onSuccess?.({ movement, updatedBed: resolution.value.updatedBed });
    },
    [createEmptyPatient, movementKey, notifyUndoError, patchRecord, saveAndUpdate]
  );
};
