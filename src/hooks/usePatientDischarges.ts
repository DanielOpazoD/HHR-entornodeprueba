import { useMemo, useCallback } from 'react';
import { DailyRecord } from '@/types';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants';
import { useLatestRef } from '@/hooks/useLatestRef';
import type { DischargeTarget } from '@/features/census/domain/movements/contracts';
import { resolveAddDischargeMovement } from '@/features/census/controllers/patientMovementCreationController';
import {
  buildAddDischargeInput,
  buildDischargeAddCommandPayload,
} from '@/features/census/controllers/patientMovementCreationInputController';
import {
  resolveDeleteDischargeMovement,
  resolveUpdateDischargeMovement,
} from '@/features/census/controllers/patientMovementMutationController';
import { resolveApplyUndoDischargeRecord } from '@/features/census/controllers/patientMovementUndoMutationController';
import {
  PatientMovementRuntime,
  patientMovementBrowserRuntime,
} from '@/features/census/controllers/patientMovementRuntimeController';
import { selectDischargeUndoMovement } from '@/features/census/controllers/patientMovementSelectionController';
import { usePatientMovementFeedback } from '@/features/census/hooks/usePatientMovementFeedback';
import { usePatientMovementAudit } from '@/features/census/hooks/usePatientMovementAudit';
import { usePatientMovementCreationExecutor } from '@/features/census/hooks/usePatientMovementCreationExecutor';
import { usePatientMovementUndoExecutor } from '@/features/census/hooks/usePatientMovementUndoExecutor';
import { usePatientMovementCurrentRecord } from '@/features/census/hooks/usePatientMovementCurrentRecord';
import { usePatientMovementMutationExecutor } from '@/features/census/hooks/usePatientMovementMutationExecutor';
import type {
  AddDischargeAction,
  DeleteDischargeAction,
  DischargeMovementActions,
  UndoDischargeAction,
  UpdateDischargeAction,
} from '@/features/census/domain/movements/contracts';

export const usePatientDischarges = (
  record: DailyRecord | null,
  saveAndUpdate: (updatedRecord: DailyRecord) => void,
  runtime: PatientMovementRuntime = patientMovementBrowserRuntime
): DischargeMovementActions => {
  const recordRef = useLatestRef(record);
  const { notifyCreationError, notifyUndoError } = usePatientMovementFeedback(runtime);
  const { logDischargeEntries } = usePatientMovementAudit();
  const executeMovementCreation = usePatientMovementCreationExecutor({
    saveAndUpdate,
    notifyCreationError,
  });
  const executeMovementMutation = usePatientMovementMutationExecutor({
    recordRef,
    saveAndUpdate,
  });
  const withCurrentRecord = usePatientMovementCurrentRecord({ recordRef });
  const executeMovementUndo = usePatientMovementUndoExecutor({
    createEmptyPatient,
    saveAndUpdate,
    notifyUndoError,
  });

  const addDischarge: AddDischargeAction = useCallback(
    (
      bedId,
      status,
      cribStatus,
      dischargeType,
      dischargeTypeOther,
      time,
      target: DischargeTarget = 'both',
      movementDate
    ) => {
      withCurrentRecord(currentRecord => {
        const payload = buildDischargeAddCommandPayload({
          status,
          cribStatus,
          dischargeType,
          dischargeTypeOther,
          time,
          movementDate,
          target,
        });
        const resolution = resolveAddDischargeMovement(
          buildAddDischargeInput({
            record: currentRecord,
            bedId,
            payload,
            bedsCatalog: BEDS,
            createEmptyPatient,
          })
        );
        executeMovementCreation({
          kind: 'discharge',
          bedId,
          resolution,
          onSuccess: value => {
            logDischargeEntries(value.auditEntries, currentRecord.date);
          },
        });
      });
    },
    [executeMovementCreation, logDischargeEntries, withCurrentRecord]
  );

  const updateDischarge: UpdateDischargeAction = useCallback(
    (id, status, dischargeType, dischargeTypeOther, time, movementDate) => {
      executeMovementMutation(record =>
        resolveUpdateDischargeMovement({
          record,
          id,
          status,
          dischargeType,
          dischargeTypeOther,
          time,
          movementDate,
        })
      );
    },
    [executeMovementMutation]
  );

  const deleteDischarge: DeleteDischargeAction = useCallback(
    id => {
      executeMovementMutation(record =>
        resolveDeleteDischargeMovement({
          record,
          id,
        })
      );
    },
    [executeMovementMutation]
  );

  const undoDischarge: UndoDischargeAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
        const discharge = selectDischargeUndoMovement(currentRecord, id);
        executeMovementUndo({
          kind: 'discharge',
          movement: discharge,
          record: currentRecord,
          applyUndoRecord: ({ record, movementId, bedId, updatedBed }) =>
            resolveApplyUndoDischargeRecord({
              record,
              dischargeId: movementId,
              bedId,
              updatedBed,
            }),
        });
      });
    },
    [executeMovementUndo, withCurrentRecord]
  );

  return useMemo(
    () => ({
      addDischarge,
      updateDischarge,
      deleteDischarge,
      undoDischarge,
    }),
    [addDischarge, updateDischarge, deleteDischarge, undoDischarge]
  );
};
