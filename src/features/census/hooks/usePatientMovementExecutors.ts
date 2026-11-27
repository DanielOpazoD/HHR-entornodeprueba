import { useCallback, useMemo, type MutableRefObject } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { ControllerResult } from '@/shared/contracts/controllerResult';
import { patientMovementRuntimeLogger } from '@/hooks/controllers/hookControllerLoggers';
import {
  buildAtomicPatientMovementPatch,
  resolveAtomicPatientMovementListKey,
  type AtomicPatientMovementListKey,
} from '@/features/census/controllers/atomicPatientMovementPatchController';
import type {
  MovementCreationError,
  MovementCreationErrorCode,
} from '@/features/census/controllers/patientMovementCreationController';
import type { PatientMovementRuntime } from '@/features/census/controllers/patientMovementRuntimeController';
import {
  resolveUndoPatientMovement,
  type UndoPatientMovementErrorCode,
} from '@/features/census/controllers/patientMovementUndoController';
import {
  getUndoMovementErrorMessage,
  type UndoMovementKind,
} from '@/features/census/controllers/patientMovementUndoErrorPresentation';
import type { UndoMovementDescriptor } from '@/features/census/controllers/patientMovementSelectionController';

export type MovementKind = 'discharge' | 'transfer';

export const getMovementCreationWarningMessage = (
  kind: MovementKind,
  code: MovementCreationErrorCode,
  bedId: string
): string => {
  if (kind === 'discharge') {
    return code === 'SOURCE_BED_EMPTY'
      ? `Attempted to discharge empty bed: ${bedId}`
      : `Attempted to discharge unknown bed: ${bedId}`;
  }

  return code === 'SOURCE_BED_EMPTY'
    ? `Attempted to transfer empty bed: ${bedId}`
    : `Attempted to transfer unknown bed: ${bedId}`;
};

interface UndoDescriptor {
  patientName: string;
  bedName: string;
}

const presentMovementWarning = (runtime: PatientMovementRuntime, warningMessage: string) => {
  if (runtime.warn) {
    runtime.warn(warningMessage);
    return;
  }

  patientMovementRuntimeLogger.warn(warningMessage);
};

export const usePatientMovementFeedback = (runtime: PatientMovementRuntime) => {
  const notifyCreationError = useCallback(
    (kind: MovementKind, code: MovementCreationErrorCode, bedId: string) => {
      presentMovementWarning(runtime, getMovementCreationWarningMessage(kind, code, bedId));
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

type MovementCreationResolution<TValue extends { updatedRecord: DailyRecord }> = ControllerResult<
  TValue,
  MovementCreationErrorCode,
  MovementCreationError
>;

interface ExecuteMovementCreationParams<TValue extends { updatedRecord: DailyRecord }> {
  kind: MovementKind;
  bedId: string;
  resolution: MovementCreationResolution<TValue>;
  baseRecord?: DailyRecord;
  onSuccess?: (value: TValue) => void;
}

interface UsePatientMovementCreationExecutorParams {
  saveAndUpdate: PersistDailyRecord;
  patchRecord?: ApplyDailyRecordPatch;
  notifyCreationError: (kind: MovementKind, code: MovementCreationErrorCode, bedId: string) => void;
}

export const usePatientMovementCreationExecutor = ({
  saveAndUpdate,
  patchRecord,
  notifyCreationError,
}: UsePatientMovementCreationExecutorParams) => {
  return useCallback(
    async <TValue extends { updatedRecord: DailyRecord }>({
      kind,
      bedId,
      resolution,
      baseRecord,
      onSuccess,
    }: ExecuteMovementCreationParams<TValue>): Promise<void> => {
      if (!resolution.ok) {
        notifyCreationError(kind, resolution.error.code, bedId);
        return;
      }

      if (patchRecord) {
        await patchRecord(
          buildAtomicPatientMovementPatch({
            updatedRecord: resolution.value.updatedRecord,
            movementKey: resolveAtomicPatientMovementListKey(kind),
            sourceBedIds: [bedId],
          })
        );
      } else {
        await saveAndUpdate(resolution.value.updatedRecord, baseRecord);
      }
      onSuccess?.(resolution.value);
    },
    [notifyCreationError, patchRecord, saveAndUpdate]
  );
};

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

      await saveAndUpdate(updatedRecord, record);
    },
    [movementKey, patchRecord, recordRef, saveAndUpdate]
  );
};

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
        await saveAndUpdate(nextRecord, record);
      }

      onSuccess?.({ movement, updatedBed: resolution.value.updatedBed });
    },
    [createEmptyPatient, movementKey, notifyUndoError, patchRecord, saveAndUpdate]
  );
};
