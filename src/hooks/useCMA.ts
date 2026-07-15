import { useMemo, useCallback, useRef, useEffect } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  DailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { CMAData } from '@/types/domain/movements';
import { capitalizeWords } from '@/utils/stringUtils';
import { formatRut, isValidRut, isPassportFormat } from '@/utils/rutUtils';
import { buildClearPatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { buildAtomicPatientMovementPatch, buildUndoCmaPatch } from '@/application/census/public';
import { tombstoneMovementById } from '@/application/census/movementTombstonePolicy';
import {
  convertCmaToHomeDischargeRecord,
  convertCmaToTransferRecord,
  selectMovementReclassificationSummary,
} from '@/application/census/movementTypeConversionPolicy';
import { buildCmaEpisodeMovementFields } from '@/application/census/cmaEpisodeMovementFields';
import { ensurePatientClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import { patientMovementRuntimeLogger } from '@/hooks/controllers/hookControllerLoggers';
import { usePatientMovementAudit } from '@/hooks/usePatientMovementAudit';
import { useMovementReclassificationExecution } from '@/hooks/useMovementReclassificationExecution';
import {
  buildManualMovementProvenanceSeed,
  buildMovementProvenance,
} from '@/application/census/movementProvenancePolicy';

const logCmaPersistenceFailure = (action: string, error: unknown): void => {
  patientMovementRuntimeLogger.warn(`CMA ${action} persistence failed`, error);
};

const logCmaAuditFailure = (action: string, error: unknown): void => {
  patientMovementRuntimeLogger.warn(`CMA ${action} audit failed`, error);
};

/**
 * Normalize CMA patient data fields
 */
const normalizePatientData = (data: Partial<CMAData>): Partial<CMAData> => {
  const normalized = { ...data };

  // Capitalize patient name
  if (normalized.patientName && typeof normalized.patientName === 'string') {
    normalized.patientName = capitalizeWords(normalized.patientName.trim());
  }

  // Format RUT (if not passport)
  if (normalized.rut && typeof normalized.rut === 'string') {
    const trimmedRut = normalized.rut.trim();
    if (!isPassportFormat(trimmedRut)) {
      const formatted = formatRut(trimmedRut);
      if (isValidRut(formatted)) {
        normalized.rut = formatted;
      }
    }
  }

  return normalized;
};

export const useCMA = (
  record: DailyRecord | null,
  _saveAndUpdate: PersistDailyRecord,
  patchRecord: ApplyDailyRecordPatch
) => {
  const recordRef = useRef(record);
  const { logDischargeDiagnosisChange, logDischargeReclassification, actor } =
    usePatientMovementAudit();
  const executeReclassification = useMovementReclassificationExecution();
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const addCMA = useCallback(
    (data: Omit<CMAData, 'id' | 'timestamp'>) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      // Normalize data before saving
      const normalizedData = normalizePatientData(data);
      const sourceBedId =
        data.originalBedId && currentRecord.beds?.[data.originalBedId] ? data.originalBedId : null;
      const sourcePatientWithEpisodeId = sourceBedId
        ? ensurePatientClinicalEpisodeId(currentRecord.beds[sourceBedId])
        : null;

      const id = crypto.randomUUID();
      const provenance = buildManualMovementProvenanceSeed(actor);
      const newEntry: CMAData = {
        ...data,
        ...normalizedData,
        ...buildCmaEpisodeMovementFields(normalizedData, sourcePatientWithEpisodeId),
        id,
        timestamp: new Date().toISOString(),
        movementProvenance: buildMovementProvenance({ movementId: id, ...provenance }),
      };

      const updatedCma = [...(currentRecord.cma || []), newEntry];
      const updatedRecord = {
        ...currentRecord,
        cma: updatedCma,
      };

      if (sourceBedId) {
        const clearPatch = buildClearPatientPatches(currentRecord, sourceBedId);
        updatedRecord.beds = {
          ...currentRecord.beds,
          [sourceBedId]: clearPatch[`beds.${sourceBedId}`] as DailyRecord['beds'][string],
        };
      }

      void Promise.resolve(
        patchRecord(
          buildAtomicPatientMovementPatch({
            updatedRecord,
            movementKey: 'cma',
            sourceBedIds: sourceBedId ? [sourceBedId] : [],
          })
        )
      ).catch(error => {
        logCmaPersistenceFailure('create', error);
      });
    },
    [actor, patchRecord]
  );

  const deleteCMA = useCallback(
    (id: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const currentList = currentRecord.cma || [];
      void Promise.resolve(
        patchRecord({
          cma: tombstoneMovementById(currentList, id),
        })
      ).catch(error => {
        logCmaPersistenceFailure('delete', error);
      });
    },
    [patchRecord]
  );

  const updateCMA = useCallback(
    (id: string, updates: Partial<CMAData>) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      // Normalize data before saving
      const normalizedUpdates = normalizePatientData(updates);

      const currentList = currentRecord.cma || [];
      const previous = currentList.find(item => item.id === id);
      void Promise.resolve(
        patchRecord({
          cma: currentList.map(item => (item.id === id ? { ...item, ...normalizedUpdates } : item)),
        })
      )
        .then(() => {
          if (
            previous &&
            normalizedUpdates.diagnosis !== undefined &&
            previous.diagnosis !== normalizedUpdates.diagnosis
          ) {
            try {
              logDischargeDiagnosisChange(
                {
                  movementId: previous.id,
                  entityType: 'discharge',
                  patientName: previous.patientName,
                  rut: previous.rut,
                  movementLabel: 'CMA',
                  previousDiagnosis: previous.diagnosis,
                  nextDiagnosis: normalizedUpdates.diagnosis,
                  clinicalEpisodeId: previous.clinicalEpisodeId,
                },
                currentRecord.date
              );
            } catch (error) {
              logCmaAuditFailure('diagnosis_change', error);
            }
          }
        })
        .catch(error => {
          logCmaPersistenceFailure('update', error);
        });
    },
    [logDischargeDiagnosisChange, patchRecord]
  );

  const undoCMA = useCallback(
    (item: CMAData) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const patch = buildUndoCmaPatch(currentRecord, item);
      if (!patch) return;

      void Promise.resolve(patchRecord(patch as DailyRecordPatch)).catch(error => {
        logCmaPersistenceFailure('undo', error);
      });
    },
    [patchRecord]
  );

  const convertCmaToHomeDischarge = useCallback(
    (id: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const updatedRecord = convertCmaToHomeDischargeRecord(
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
          patchRecord({
            cma: updatedRecord.cma,
            discharges: updatedRecord.discharges,
          }),
        onPersisted: () => {
          if (!summary) return;
          try {
            logDischargeReclassification(summary, currentRecord.date);
          } catch (error) {
            logCmaAuditFailure('convert_to_discharge', error);
          }
        },
        onPersistenceError: error => logCmaPersistenceFailure('convert_to_discharge', error),
      });
    },
    [actor, executeReclassification, logDischargeReclassification, patchRecord]
  );

  const convertCmaToTransfer = useCallback(
    (id: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const updatedRecord = convertCmaToTransferRecord(
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
        persist: () => patchRecord({ cma: updatedRecord.cma, transfers: updatedRecord.transfers }),
        onPersisted: () => {
          if (!summary) return;
          try {
            logDischargeReclassification(summary, currentRecord.date);
          } catch (error) {
            logCmaAuditFailure('convert_to_transfer', error);
          }
        },
        onPersistenceError: error => logCmaPersistenceFailure('convert_to_transfer', error),
      });
    },
    [actor, executeReclassification, logDischargeReclassification, patchRecord]
  );

  return useMemo(
    () => ({
      addCMA,
      deleteCMA,
      updateCMA,
      undoCMA,
      convertCmaToHomeDischarge,
      convertCmaToTransfer,
    }),
    [addCMA, deleteCMA, updateCMA, undoCMA, convertCmaToHomeDischarge, convertCmaToTransfer]
  );
};
