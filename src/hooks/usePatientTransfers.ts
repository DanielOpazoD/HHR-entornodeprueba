import { useMemo, useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants/beds';
import { useLatestRef } from '@/hooks/useLatestRef';
import {
  resolveAddTransferMovement,
  buildAddTransferInput,
  buildTransferCommandPayload,
  resolveDeleteTransferMovement,
  resolveUpdateTransferMovement,
  resolveApplyUndoTransferRecord,
  PatientMovementRuntime,
  patientMovementBrowserRuntime,
  selectTransferUndoMovement,
} from '@/application/census/public';
import { usePatientMovementFeedback } from '@/hooks/usePatientMovementFeedback';
import { usePatientMovementAudit } from '@/hooks/usePatientMovementAudit';
import { usePatientMovementCreationExecutor } from '@/hooks/usePatientMovementCreationExecutor';
import { usePatientMovementUndoExecutor } from '@/hooks/usePatientMovementUndoExecutor';
import { usePatientMovementCurrentRecord } from '@/hooks/usePatientMovementCurrentRecord';
import { usePatientMovementMutationExecutor } from '@/hooks/usePatientMovementMutationExecutor';
import { usePatientMovementMutationByIdExecutor } from '@/hooks/usePatientMovementMutationByIdExecutor';
import { useMovementReclassificationExecution } from '@/hooks/useMovementReclassificationExecution';
import { patientMovementRuntimeLogger } from '@/hooks/controllers/hookControllerLoggers';
import {
  convertTransferToCmaRecord,
  convertTransferToHomeDischargeRecord,
  selectMovementReclassificationSummary,
} from '@/application/census/movementTypeConversionPolicy';
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
  const withCurrentRecord = usePatientMovementCurrentRecord({ recordRef });
  const executeMovementUndo = usePatientMovementUndoExecutor({
    createEmptyPatient,
    saveAndUpdate,
    patchRecord,
    movementKey: 'transfers',
    notifyUndoError,
  });

  const executeTransferMutation = usePatientMovementMutationByIdExecutor({
    executeMovementMutation,
  });
  const executeReclassification = useMovementReclassificationExecution();

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
            provenance: buildManualMovementProvenanceSeed(actor),
          })
        );
        void executeMovementCreation({
          kind: 'transfer',
          bedId,
          resolution,
          onSuccess: value => {
            logTransferEntry(value.auditEntry, currentRecord.date);
          },
        }).catch(error => {
          logTransferPersistenceFailure('create', error);
        });
      });
    },
    [actor, executeMovementCreation, logTransferEntry, withCurrentRecord]
  );

  const updateTransfer: UpdateTransferAction = useCallback(
    (id, updates) => {
      withCurrentRecord(currentRecord => {
        const previous = currentRecord.transfers.find(transfer => transfer.id === id);
        void executeTransferMutation(
          (record, movementId) =>
            resolveUpdateTransferMovement({
              record,
              id: movementId,
              updates,
            }),
          id
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
          })
          .catch(error => {
            logTransferPersistenceFailure('update', error);
          });
      });
    },
    [executeTransferMutation, logDischargeDiagnosisChange, withCurrentRecord]
  );

  const deleteTransfer: DeleteTransferAction = useCallback(
    id => {
      void executeTransferMutation(
        (record, movementId) =>
          resolveDeleteTransferMovement({
            record,
            id: movementId,
          }),
        id
      ).catch(error => {
        logTransferPersistenceFailure('delete', error);
      });
    },
    [executeTransferMutation]
  );

  const undoTransfer: UndoTransferAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
        const transfer = selectTransferUndoMovement(currentRecord, id);
        void executeMovementUndo({
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
        }).catch(error => {
          logTransferPersistenceFailure('undo', error);
        });
      });
    },
    [executeMovementUndo, withCurrentRecord]
  );

  const convertTransferToHomeDischarge: ConvertTransferToHomeDischargeAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
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
          persist: () => (patchRecord ? patchRecord(patch) : saveAndUpdate(updatedRecord)),
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
      });
    },
    [
      actor,
      executeReclassification,
      logDischargeReclassification,
      patchRecord,
      saveAndUpdate,
      withCurrentRecord,
    ]
  );

  const convertTransferToCma: ConvertTransferToCmaAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
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
          persist: () => (patchRecord ? patchRecord(patch) : saveAndUpdate(updatedRecord)),
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
      });
    },
    [
      actor,
      executeReclassification,
      logDischargeReclassification,
      patchRecord,
      saveAndUpdate,
      withCurrentRecord,
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
