import { useMemo, useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { BEDS } from '@/constants/beds';
import { useLatestRef } from '@/hooks/useLatestRef';
import { resolveAddTransferMovement } from '@/features/census/controllers/patientMovementCreationController';
import {
  resolveDeleteTransferMovement,
  resolveUpdateTransferMovement,
} from '@/features/census/controllers/patientMovementMutationController';
import { resolveApplyUndoTransferRecord } from '@/features/census/controllers/patientMovementUndoMutationController';
import {
  patientMovementBrowserRuntime,
  type PatientMovementRuntime,
} from '@/features/census/controllers/patientMovementRuntimeController';
import { selectTransferUndoMovement } from '@/features/census/controllers/patientMovementSelectionController';
import {
  usePatientMovementCreationExecutor,
  usePatientMovementFeedback,
  usePatientMovementMutationExecutor,
  usePatientMovementUndoExecutor,
} from '@/features/census/hooks/usePatientMovementExecutors';
import { usePatientMovementAudit } from '@/features/census/hooks/usePatientMovementAudit';
import { useMovementReclassificationExecution } from '@/features/census/hooks/useMovementReclassificationExecution';
import { patientMovementRuntimeLogger } from '@/hooks/controllers/hookControllerLoggers';
import {
  convertTransferToCmaRecord,
  convertTransferToHomeDischargeRecord,
  selectMovementReclassificationSummary,
} from '@/features/census/controllers/movementTypeConversionPolicy';
import type {
  AddTransferAction,
  DeleteTransferAction,
  ConvertTransferToCmaAction,
  ConvertTransferToHomeDischargeAction,
  TransferMovementActions,
  UndoTransferAction,
  UpdateTransferAction,
} from '@/types/movements';
import { buildManualMovementProvenanceSeed } from '@/application/census/movementProvenancePolicy';

const logTransferPersistenceFailure = (action: string, error: unknown): void => {
  patientMovementRuntimeLogger.warn(`Transfer ${action} persistence failed`, error);
};

const logTransferAuditFailure = (action: string, error: unknown): void => {
  patientMovementRuntimeLogger.warn(`Transfer ${action} audit failed`, error);
};

export const usePatientTransfers = (
  record: DailyRecord | null,
  saveAndUpdate: PersistDailyRecord,
  runtime: PatientMovementRuntime = patientMovementBrowserRuntime,
  patchRecord?: ApplyDailyRecordPatch
): TransferMovementActions => {
  const recordRef = useLatestRef(record);
  const { notifyCreationError, notifyUndoError } = usePatientMovementFeedback(runtime);
  const { logDischargeDiagnosisChange, logDischargeReclassification, logTransferEntry, actor } =
    usePatientMovementAudit();
  const executeMovementCreation = usePatientMovementCreationExecutor({
    saveAndUpdate,
    patchRecord,
    notifyCreationError,
  });
  const executeMovementMutation = usePatientMovementMutationExecutor({
    recordRef,
    saveAndUpdate,
    patchRecord,
    movementKey: 'transfers',
  });
  const executeMovementUndo = usePatientMovementUndoExecutor({
    createEmptyPatient,
    saveAndUpdate,
    patchRecord,
    movementKey: 'transfers',
    notifyUndoError,
  });
  const executeReclassification = useMovementReclassificationExecution();

  const addTransfer: AddTransferAction = useCallback(
    (bedId, payload) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const resolution = resolveAddTransferMovement({
        record: currentRecord,
        bedId,
        payload,
        bedsCatalog: BEDS,
        createEmptyPatient,
        provenance: buildManualMovementProvenanceSeed(actor),
      });
      void executeMovementCreation({
        kind: 'transfer',
        bedId,
        resolution,
        baseRecord: currentRecord,
        onSuccess: value => {
          logTransferEntry(value.auditEntry, currentRecord.date);
        },
      }).catch(error => {
        logTransferPersistenceFailure('create', error);
      });
    },
    [actor, executeMovementCreation, logTransferEntry, recordRef]
  );

  const updateTransfer: UpdateTransferAction = useCallback(
    (id, updates) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return undefined;
      const previous = currentRecord.transfers.find(transfer => transfer.id === id);
      if (!previous) return Promise.resolve(false);
      return executeMovementMutation(recordToMutate =>
        resolveUpdateTransferMovement({
          record: recordToMutate,
          id,
          updates,
        })
      )
        .then(() => {
          if (
            previous &&
            updates.diagnosis !== undefined &&
            previous.diagnosis !== updates.diagnosis
          ) {
            try {
              logDischargeDiagnosisChange(
                {
                  movementId: previous.id,
                  entityType: 'transfer',
                  patientName: previous.patientName,
                  rut: previous.rut,
                  movementLabel: 'Traslado',
                  previousDiagnosis: previous.diagnosis,
                  nextDiagnosis: updates.diagnosis,
                  clinicalEpisodeId: previous.clinicalEpisodeId,
                },
                currentRecord.date
              );
            } catch (error) {
              logTransferAuditFailure('diagnosis_change', error);
            }
          }
          return true;
        })
        .catch(error => {
          logTransferPersistenceFailure('update', error);
          return false;
        });
    },
    [executeMovementMutation, logDischargeDiagnosisChange, recordRef]
  );

  const deleteTransfer: DeleteTransferAction = useCallback(
    id => {
      void executeMovementMutation(recordToMutate =>
        resolveDeleteTransferMovement({
          record: recordToMutate,
          id,
        })
      ).catch(error => {
        logTransferPersistenceFailure('delete', error);
      });
    },
    [executeMovementMutation]
  );

  const undoTransfer: UndoTransferAction = useCallback(
    id => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const transfer = selectTransferUndoMovement(currentRecord, id);
      void executeMovementUndo({
        kind: 'transfer',
        movement: transfer,
        record: currentRecord,
        applyUndoRecord: ({ record: recordToMutate, movementId, bedId, updatedBed }) =>
          resolveApplyUndoTransferRecord({
            record: recordToMutate,
            transferId: movementId,
            bedId,
            updatedBed,
          }),
      }).catch(error => {
        logTransferPersistenceFailure('undo', error);
      });
    },
    [executeMovementUndo, recordRef]
  );

  const convertTransferToHomeDischarge: ConvertTransferToHomeDischargeAction = useCallback(
    id => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const updatedRecord = convertTransferToHomeDischargeRecord(
        currentRecord,
        id,
        () => crypto.randomUUID(),
        { actor, at: new Date().toISOString() }
      );
      if (updatedRecord === currentRecord) return;
      const patch = {
        transfers: updatedRecord.transfers,
        discharges: updatedRecord.discharges,
      };
      const summary = selectMovementReclassificationSummary(updatedRecord, id);
      executeReclassification({
        recordDate: currentRecord.date,
        sourceMovementId: id,
        persist: () =>
          patchRecord ? patchRecord(patch) : saveAndUpdate(updatedRecord, currentRecord),
        onPersisted: () => {
          if (!summary) return;
          try {
            logDischargeReclassification(summary, currentRecord.date);
          } catch (error) {
            logTransferAuditFailure('convert_to_discharge', error);
          }
        },
        onPersistenceError: error => logTransferPersistenceFailure('convert_to_discharge', error),
      });
    },
    [
      actor,
      executeReclassification,
      logDischargeReclassification,
      patchRecord,
      recordRef,
      saveAndUpdate,
    ]
  );

  const convertTransferToCma: ConvertTransferToCmaAction = useCallback(
    id => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const updatedRecord = convertTransferToCmaRecord(
        currentRecord,
        id,
        () => crypto.randomUUID(),
        { actor, at: new Date().toISOString() }
      );
      if (updatedRecord === currentRecord) return;
      const patch = { transfers: updatedRecord.transfers, cma: updatedRecord.cma };
      const summary = selectMovementReclassificationSummary(updatedRecord, id);
      executeReclassification({
        recordDate: currentRecord.date,
        sourceMovementId: id,
        persist: () =>
          patchRecord ? patchRecord(patch) : saveAndUpdate(updatedRecord, currentRecord),
        onPersisted: () => {
          if (!summary) return;
          try {
            logDischargeReclassification(summary, currentRecord.date);
          } catch (error) {
            logTransferAuditFailure('convert_to_cma', error);
          }
        },
        onPersistenceError: error => logTransferPersistenceFailure('convert_to_cma', error),
      });
    },
    [
      actor,
      executeReclassification,
      logDischargeReclassification,
      patchRecord,
      recordRef,
      saveAndUpdate,
    ]
  );

  return useMemo(
    () => ({
      addTransfer,
      updateTransfer,
      deleteTransfer,
      undoTransfer,
      convertTransferToHomeDischarge,
      convertTransferToCma,
    }),
    [
      addTransfer,
      updateTransfer,
      deleteTransfer,
      undoTransfer,
      convertTransferToHomeDischarge,
      convertTransferToCma,
    ]
  );
};
