import { useCallback, useMemo } from 'react';
import { MovementCreationErrorCode } from '@/features/census/controllers/patientMovementCreationController';
import {
  getMovementCreationWarningMessage,
  MovementKind,
} from '@/features/census/controllers/patientMovementCreationErrorPresentation';
import { PatientMovementRuntime } from '@/features/census/controllers/patientMovementRuntimeController';
import { UndoPatientMovementErrorCode } from '@/features/census/controllers/patientMovementUndoController';
import {
  getUndoMovementErrorMessage,
  UndoMovementKind,
} from '@/features/census/controllers/patientMovementUndoErrorPresentation';

interface UndoDescriptor {
  patientName: string;
  bedName: string;
}

export const usePatientMovementFeedback = (runtime: PatientMovementRuntime) => {
  const notifyCreationError = useCallback(
    (kind: MovementKind, code: MovementCreationErrorCode, bedId: string) => {
      const warningMessage = getMovementCreationWarningMessage(kind, code, bedId);
      if (runtime.warn) {
        runtime.warn(warningMessage);
        return;
      }
      console.warn(warningMessage);
    },
    [runtime]
  );

  const notifyUndoError = useCallback(
    (kind: UndoMovementKind, code: UndoPatientMovementErrorCode, descriptor: UndoDescriptor) => {
      runtime.alert(getUndoMovementErrorMessage(kind, code, descriptor));
    },
    [runtime]
  );

  return useMemo(
    () => ({
      notifyCreationError,
      notifyUndoError,
    }),
    [notifyCreationError, notifyUndoError]
  );
};
