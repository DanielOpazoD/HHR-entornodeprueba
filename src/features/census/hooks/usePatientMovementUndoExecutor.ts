import { useCallback } from 'react';
import { DailyRecord, PatientData } from '@/types';
import { resolveUndoPatientMovement } from '@/features/census/controllers/patientMovementUndoController';
import { UndoMovementKind } from '@/features/census/controllers/patientMovementUndoErrorPresentation';
import { UndoPatientMovementErrorCode } from '@/features/census/controllers/patientMovementUndoController';
import { UndoMovementDescriptor } from '@/features/census/controllers/patientMovementSelectionController';

interface UndoApplyParams {
  record: DailyRecord;
  movementId: string;
  bedId: string;
  updatedBed: PatientData;
}

interface UsePatientMovementUndoExecutorParams {
  createEmptyPatient: (bedId: string) => PatientData;
  saveAndUpdate: (updatedRecord: DailyRecord) => void;
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
}

export const usePatientMovementUndoExecutor = ({
  createEmptyPatient,
  saveAndUpdate,
  notifyUndoError,
}: UsePatientMovementUndoExecutorParams) => {
  return useCallback(
    ({ kind, movement, record, applyUndoRecord }: ExecuteUndoParams) => {
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

      saveAndUpdate(
        applyUndoRecord({
          record,
          movementId: movement.id,
          bedId: movement.bedId,
          updatedBed: resolution.value.updatedBed,
        })
      );
    },
    [createEmptyPatient, notifyUndoError, saveAndUpdate]
  );
};
