import { useCallback } from 'react';
import { DailyRecord } from '@/types';
import {
  MovementCreationError,
  MovementCreationErrorCode,
} from '@/features/census/controllers/patientMovementCreationController';
import { MovementKind } from '@/features/census/controllers/patientMovementCreationErrorPresentation';
import { ControllerResult } from '@/features/census/controllers/controllerResult';

type MovementCreationResolution<TValue extends { updatedRecord: DailyRecord }> = ControllerResult<
  TValue,
  MovementCreationErrorCode,
  MovementCreationError
>;

interface ExecuteMovementCreationParams<TValue extends { updatedRecord: DailyRecord }> {
  kind: MovementKind;
  bedId: string;
  resolution: MovementCreationResolution<TValue>;
  onSuccess?: (value: TValue) => void;
}

interface UsePatientMovementCreationExecutorParams {
  saveAndUpdate: (updatedRecord: DailyRecord) => void;
  notifyCreationError: (kind: MovementKind, code: MovementCreationErrorCode, bedId: string) => void;
}

export const usePatientMovementCreationExecutor = ({
  saveAndUpdate,
  notifyCreationError,
}: UsePatientMovementCreationExecutorParams) => {
  return useCallback(
    <TValue extends { updatedRecord: DailyRecord }>({
      kind,
      bedId,
      resolution,
      onSuccess,
    }: ExecuteMovementCreationParams<TValue>) => {
      if (!resolution.ok) {
        notifyCreationError(kind, resolution.error.code, bedId);
        return;
      }

      saveAndUpdate(resolution.value.updatedRecord);
      onSuccess?.(resolution.value);
    },
    [notifyCreationError, saveAndUpdate]
  );
};
