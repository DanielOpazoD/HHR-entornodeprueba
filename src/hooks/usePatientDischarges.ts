import { useMemo, useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants/beds';
import { useLatestRef } from '@/hooks/useLatestRef';
import type { DischargeTarget } from '@/types/movements';
import {
  resolveAddDischargeMovement,
  buildAddDischargeInput,
  buildDischargeAddCommandPayload,
  resolveDeleteDischargeMovement,
  resolveUpdateDischargeMovement,
  resolveApplyUndoDischargeRecord,
  PatientMovementRuntime,
  patientMovementBrowserRuntime,
  selectDischargeUndoMovement,
  selectMovementUndoAuditMetadata,
} from '@/application/census/public';
import {
  convertDischargeToCmaRecord,
  convertDischargeToTransferRecord,
  selectMovementReclassificationSummary,
} from '@/application/census/movementTypeConversionPolicy';
import { usePatientMovementFeedback } from '@/hooks/usePatientMovementFeedback';
import { usePatientMovementAudit } from '@/hooks/usePatientMovementAudit';
import { usePatientMovementCreationExecutor } from '@/hooks/usePatientMovementCreationExecutor';
import { usePatientMovementUndoExecutor } from '@/hooks/usePatientMovementUndoExecutor';
import { usePatientMovementCurrentRecord } from '@/hooks/usePatientMovementCurrentRecord';
import { usePatientMovementMutationExecutor } from '@/hooks/usePatientMovementMutationExecutor';
import { usePatientMovementMutationByIdExecutor } from '@/hooks/usePatientMovementMutationByIdExecutor';
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
  const withCurrentRecord = usePatientMovementCurrentRecord({ recordRef });
  const executeMovementUndo = usePatientMovementUndoExecutor({
    createEmptyPatient,
    saveAndUpdate,
    patchRecord,
    movementKey: 'discharges',
    notifyUndoError,
  });

  const executeDischargeMutation = usePatientMovementMutationByIdExecutor({
    executeMovementMutation,
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
            provenance: buildManualMovementProvenanceSeed(actor),
          })
        );
        void executeMovementCreation({
          kind: 'discharge',
          bedId,
          resolution,
          onSuccess: value => {
            logDischargeEntries(value.auditEntries, currentRecord.date);
          },
        }).catch(error => {
          logDischargePersistenceFailure('create', error);
        });
      });
    },
    [actor, executeMovementCreation, logDischargeEntries, withCurrentRecord]
  );

  const updateDischarge: UpdateDischargeAction = useCallback(
    (id, status, dischargeType, dischargeTypeOther, time, movementDate, ieehData, diagnosis) => {
      withCurrentRecord(currentRecord => {
        const previous = currentRecord.discharges.find(discharge => discharge.id === id);
        void executeDischargeMutation(
          (record, movementId) =>
            resolveUpdateDischargeMovement({
              record,
              id: movementId,
              status,
              dischargeType,
              dischargeTypeOther,
              time,
              movementDate,
              ieehData,
              diagnosis,
            }),
          id
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
      });
    },
    [executeDischargeMutation, logDischargeDiagnosisChange, withCurrentRecord]
  );

  const deleteDischarge: DeleteDischargeAction = useCallback(
    id => {
      void executeDischargeMutation(
        (record, movementId) =>
          resolveDeleteDischargeMovement({
            record,
            id: movementId,
          }),
        id
      ).catch(error => {
        logDischargePersistenceFailure('delete', error);
      });
    },
    [executeDischargeMutation]
  );

  const undoDischarge: UndoDischargeAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
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
          applyUndoRecord: ({ record, movementId, bedId, updatedBed }) =>
            resolveApplyUndoDischargeRecord({
              record,
              dischargeId: movementId,
              bedId,
              updatedBed,
            }),
        }).catch(error => {
          logDischargePersistenceFailure('undo', error);
        });
      });
    },
    [executeMovementUndo, logDischargeUndoEntry, withCurrentRecord]
  );

  const convertDischargeToCma: ConvertDischargeToCmaAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
        const updatedRecord = convertDischargeToCmaRecord(
          currentRecord,
          id,
          () => crypto.randomUUID(),
          { actor, at: new Date().toISOString() }
        );
        if (updatedRecord === currentRecord) return;
        const summary = selectMovementReclassificationSummary(updatedRecord, id);
        const persistence = patchRecord
          ? patchRecord({ discharges: updatedRecord.discharges, cma: updatedRecord.cma })
          : saveAndUpdate(updatedRecord);
        void persistence
          .then(() => {
            if (!summary) return;
            try {
              logDischargeReclassification(summary, currentRecord.date);
            } catch (error) {
              logDischargeAuditFailure('convert_to_cma', error);
            }
          })
          .catch(error => logDischargePersistenceFailure('convert_to_cma', error));
      });
    },
    [actor, logDischargeReclassification, patchRecord, saveAndUpdate, withCurrentRecord]
  );

  const convertDischargeToTransfer: ConvertDischargeToTransferAction = useCallback(
    id => {
      withCurrentRecord(currentRecord => {
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
        const persistence = patchRecord ? patchRecord(patch) : saveAndUpdate(updatedRecord);
        void persistence
          .then(() => {
            if (!summary) return;
            try {
              logDischargeReclassification(summary, currentRecord.date);
            } catch (error) {
              logDischargeAuditFailure('convert_to_transfer', error);
            }
          })
          .catch(error => logDischargePersistenceFailure('convert_to_transfer', error));
      });
    },
    [actor, logDischargeReclassification, patchRecord, saveAndUpdate, withCurrentRecord]
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
