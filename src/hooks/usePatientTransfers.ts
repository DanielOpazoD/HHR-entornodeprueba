import { useMemo, useCallback } from 'react';
import { DailyRecord } from '@/types';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants';
import { useLatestRef } from '@/hooks/useLatestRef';
import { resolveAddTransferMovement } from '@/features/census/controllers/patientMovementCreationController';
import {
  buildAddTransferInput,
  buildTransferCommandPayload,
} from '@/features/census/controllers/patientMovementCreationInputController';
import {
  resolveDeleteTransferMovement,
  resolveUpdateTransferMovement,
} from '@/features/census/controllers/patientMovementMutationController';
import { resolveApplyUndoTransferRecord } from '@/features/census/controllers/patientMovementUndoMutationController';
import {
  PatientMovementRuntime,
  patientMovementBrowserRuntime,
} from '@/features/census/controllers/patientMovementRuntimeController';
import { selectTransferUndoMovement } from '@/features/census/controllers/patientMovementSelectionController';
import { usePatientMovementFeedback } from '@/features/census/hooks/usePatientMovementFeedback';
import { usePatientMovementAudit } from '@/features/census/hooks/usePatientMovementAudit';
import { usePatientMovementCreationExecutor } from '@/features/census/hooks/usePatientMovementCreationExecutor';
import { usePatientMovementUndoExecutor } from '@/features/census/hooks/usePatientMovementUndoExecutor';
import { usePatientMovementCurrentRecord } from '@/features/census/hooks/usePatientMovementCurrentRecord';
import { usePatientMovementMutationExecutor } from '@/features/census/hooks/usePatientMovementMutationExecutor';
import type {
  AddTransferAction,
  DeleteTransferAction,
  TransferMovementActions,
  UndoTransferAction,
  UpdateTransferAction,
} from '@/features/census/domain/movements/contracts';

export const usePatientTransfers = (
  record: DailyRecord | null,
  saveAndUpdate: (updatedRecord: DailyRecord) => void,
  runtime: PatientMovementRuntime = patientMovementBrowserRuntime
): TransferMovementActions => {
  const recordRef = useLatestRef(record);
  const { notifyCreationError, notifyUndoError } = usePatientMovementFeedback(runtime);
  const { logTransferEntry } = usePatientMovementAudit();
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

  const addTransfer: AddTransferAction = useCallback(
    (bedId, method, center, centerOther, escort, time, movementDate) => {
      withCurrentRecord(currentRecord => {
        const payload = buildTransferCommandPayload({
          method,
          center,
          centerOther,
          escort,
          time,
          movementDate,
        });
        const resolution = resolveAddTransferMovement(
          buildAddTransferInput({
            record: currentRecord,
            bedId,
            payload,
            bedsCatalog: BEDS,
            createEmptyPatient,
          })
        );
        executeMovementCreation({
          kind: 'transfer',
          bedId,
          resolution,
          onSuccess: value => {
            logTransferEntry(value.auditEntry, currentRecord.date);
          },
        });
      });
    },
    [executeMovementCreation, logTransferEntry, withCurrentRecord]
  );

  const updateTransfer: UpdateTransferAction = useCallback(
    (id, updates) => {
      executeMovementMutation(record =>
        resolveUpdateTransferMovement({
          record,
          id,
          updates,
        })
      );
    },
    [executeMovementMutation]
  );

  const deleteTransfer: DeleteTransferAction = useCallback(
    id => {
      executeMovementMutation(record =>
        resolveDeleteTransferMovement({
          record,
          id,
        })
      );
    },
    [executeMovementMutation]
  );

  const undoTransfer: UndoTransferAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
        const transfer = selectTransferUndoMovement(currentRecord, id);
        executeMovementUndo({
          kind: 'transfer',
          movement: transfer,
          record: currentRecord,
          applyUndoRecord: ({ record, movementId, bedId, updatedBed }) =>
            resolveApplyUndoTransferRecord({
              record,
              transferId: movementId,
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
      addTransfer,
      updateTransfer,
      deleteTransfer,
      undoTransfer,
    }),
    [addTransfer, updateTransfer, deleteTransfer, undoTransfer]
  );
};
