import { useMemo, useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { BEDS } from '@/constants/beds';
import { useLatestRef } from '@/hooks/useLatestRef';
import { resolveAddDischargeMovement } from '@/features/census/controllers/patientMovementCreationController';
import {
  resolveDeleteDischargeMovement,
  resolveUpdateDischargeMovement,
} from '@/features/census/controllers/patientMovementMutationController';
import { resolveApplyUndoDischargeRecord } from '@/features/census/controllers/patientMovementUndoMutationController';
import {
  patientMovementBrowserRuntime,
  type PatientMovementRuntime,
} from '@/features/census/controllers/patientMovementRuntimeController';
import {
  selectDischargeUndoMovement,
  selectMovementUndoAuditMetadata,
} from '@/features/census/controllers/patientMovementSelectionController';
import {
  convertDischargeToCmaRecord,
  convertDischargeToTransferRecord,
  selectMovementReclassificationSummary,
} from '@/features/census/controllers/movementTypeConversionPolicy';
import {
  usePatientMovementCreationExecutor,
  usePatientMovementFeedback,
  usePatientMovementMutationExecutor,
  usePatientMovementUndoExecutor,
} from '@/features/census/hooks/usePatientMovementExecutors';
import { usePatientMovementAudit } from '@/features/census/hooks/usePatientMovementAudit';
import { useMovementReclassificationExecution } from '@/features/census/hooks/useMovementReclassificationExecution';
import { patientMovementRuntimeLogger } from '@/hooks/controllers/hookControllerLoggers';
import { buildManualMovementProvenanceSeed } from '@/application/census/movementProvenancePolicy';
import type {
  AddDischargeAction,
  ConvertDischargeToCmaAction,
  ConvertDischargeToTransferAction,
  DeleteDischargeAction,
  DischargeMovementActions,
  UndoDischargeAction,
  UpdateDischargeAction,
} from '@/types/movements';

const logDischargePersistenceFailure = (action: string, error: unknown): void => {
  patientMovementRuntimeLogger.warn(`Discharge ${action} persistence failed`, error);
};

const logDischargeAuditFailure = (action: string, error: unknown): void => {
  patientMovementRuntimeLogger.warn(`Discharge ${action} audit failed`, error);
};

export const usePatientDischarges = (
  record: DailyRecord | null,
  saveAndUpdate: PersistDailyRecord,
  runtime: PatientMovementRuntime = patientMovementBrowserRuntime,
  patchRecord?: ApplyDailyRecordPatch
): DischargeMovementActions => {
  const recordRef = useLatestRef(record);
  const { notifyCreationError, notifyUndoError } = usePatientMovementFeedback(runtime);
  const {
    logDischargeEntries,
    logDischargeDiagnosisChange,
    logDischargeReclassification,
    logDischargeUndoEntry,
    actor,
  } = usePatientMovementAudit();
  const executeMovementCreation = usePatientMovementCreationExecutor({
    saveAndUpdate,
    patchRecord,
    notifyCreationError,
  });
  const executeMovementMutation = usePatientMovementMutationExecutor({
    recordRef,
    saveAndUpdate,
    patchRecord,
    movementKey: 'discharges',
  });
  const executeMovementUndo = usePatientMovementUndoExecutor({
    createEmptyPatient,
    saveAndUpdate,
    patchRecord,
    movementKey: 'discharges',
    notifyUndoError,
  });
  const executeReclassification = useMovementReclassificationExecution();

  const addDischarge: AddDischargeAction = useCallback(
    (bedId, payload) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const resolution = resolveAddDischargeMovement({
        record: currentRecord,
        bedId,
        payload,
        bedsCatalog: BEDS,
        createEmptyPatient,
        provenance: buildManualMovementProvenanceSeed(actor),
      });
      void executeMovementCreation({
        kind: 'discharge',
        bedId,
        resolution,
        baseRecord: currentRecord,
        onSuccess: value => {
          logDischargeEntries(value.auditEntries, currentRecord.date);
        },
      }).catch(error => {
        logDischargePersistenceFailure('create', error);
      });
    },
    [actor, executeMovementCreation, logDischargeEntries, recordRef]
  );

  const updateDischarge: UpdateDischargeAction = useCallback(
    (id, status, dischargeType, dischargeTypeOther, time, movementDate, ieehData, diagnosis) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const previous = currentRecord.discharges.find(discharge => discharge.id === id);
      void executeMovementMutation(recordToMutate =>
        resolveUpdateDischargeMovement({
          record: recordToMutate,
          id,
          status,
          dischargeType,
          dischargeTypeOther,
          time,
          movementDate,
          ieehData,
          diagnosis,
        })
      )
        .then(() => {
          if (previous && diagnosis !== undefined && previous.diagnosis !== diagnosis) {
            try {
              logDischargeDiagnosisChange(
                {
                  movementId: previous.id,
                  entityType: 'discharge',
                  patientName: previous.patientName,
                  rut: previous.rut,
                  movementLabel: 'Alta',
                  previousDiagnosis: previous.diagnosis,
                  nextDiagnosis: diagnosis,
                  clinicalEpisodeId: previous.clinicalEpisodeId,
                },
                currentRecord.date
              );
            } catch (error) {
              logDischargeAuditFailure('diagnosis_change', error);
            }
          }
        })
        .catch(error => {
          logDischargePersistenceFailure('update', error);
        });
    },
    [executeMovementMutation, logDischargeDiagnosisChange, recordRef]
  );

  const deleteDischarge: DeleteDischargeAction = useCallback(
    id => {
      void executeMovementMutation(recordToMutate =>
        resolveDeleteDischargeMovement({
          record: recordToMutate,
          id,
        })
      ).catch(error => {
        logDischargePersistenceFailure('delete', error);
      });
    },
    [executeMovementMutation]
  );

  const undoDischarge: UndoDischargeAction = useCallback(
    id => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const discharge = selectDischargeUndoMovement(currentRecord, id);
      void executeMovementUndo({
        kind: 'discharge',
        movement: discharge,
        record: currentRecord,
        onSuccess: ({ movement, updatedBed }) => {
          const audit = selectMovementUndoAuditMetadata(movement, updatedBed);
          logDischargeUndoEntry(
            {
              dischargeId: movement.id,
              bedId: movement.bedId,
              patientName: audit.patientName,
              rut: audit.rut,
            },
            currentRecord.date
          );
        },
        applyUndoRecord: ({ record: recordToMutate, movementId, bedId, updatedBed }) =>
          resolveApplyUndoDischargeRecord({
            record: recordToMutate,
            dischargeId: movementId,
            bedId,
            updatedBed,
          }),
      }).catch(error => {
        logDischargePersistenceFailure('undo', error);
      });
    },
    [executeMovementUndo, logDischargeUndoEntry, recordRef]
  );

  const convertDischargeToCma: ConvertDischargeToCmaAction = useCallback(
    id => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const updatedRecord = convertDischargeToCmaRecord(
        currentRecord,
        id,
        () => crypto.randomUUID(),
        { actor, at: new Date().toISOString() }
      );
      if (updatedRecord === currentRecord) return;
      const summary = selectMovementReclassificationSummary(updatedRecord, id);
      executeReclassification({
        recordDate: currentRecord.date,
        sourceMovementId: id,
        persist: () =>
          patchRecord
            ? patchRecord({ discharges: updatedRecord.discharges, cma: updatedRecord.cma })
            : saveAndUpdate(updatedRecord, currentRecord),
        onPersisted: () => {
          if (!summary) return;
          try {
            logDischargeReclassification(summary, currentRecord.date);
          } catch (error) {
            logDischargeAuditFailure('convert_to_cma', error);
          }
        },
        onPersistenceError: error => logDischargePersistenceFailure('convert_to_cma', error),
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

  const convertDischargeToTransfer: ConvertDischargeToTransferAction = useCallback(
    id => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const updatedRecord = convertDischargeToTransferRecord(
        currentRecord,
        id,
        () => crypto.randomUUID(),
        { actor, at: new Date().toISOString() }
      );
      if (updatedRecord === currentRecord) return;
      const patch = {
        discharges: updatedRecord.discharges,
        transfers: updatedRecord.transfers,
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
            logDischargeAuditFailure('convert_to_transfer', error);
          }
        },
        onPersistenceError: error => logDischargePersistenceFailure('convert_to_transfer', error),
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
      addDischarge,
      updateDischarge,
      deleteDischarge,
      undoDischarge,
      convertDischargeToCma,
      convertDischargeToTransfer,
    }),
    [
      addDischarge,
      updateDischarge,
      deleteDischarge,
      undoDischarge,
      convertDischargeToCma,
      convertDischargeToTransfer,
    ]
  );
};
