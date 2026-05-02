import { useCallback } from 'react';
import type {
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import {
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
  notifyUndoError,
}: UsePatientMovementUndoExecutorParams) => {
  return useCallback(
    ({ kind, movement, record, applyUndoRecord, onSuccess }: ExecuteUndoParams) => {
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
      onSuccess?.({ movement, updatedBed: resolution.value.updatedBed });
      saveAndUpdate(nextRecord);
    },
    [createEmptyPatient, notifyUndoError, saveAndUpdate]
  );
};
