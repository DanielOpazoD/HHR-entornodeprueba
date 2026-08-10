import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenImportState } from './rayenImportState';
import { resetRayenFillProgress } from './useRayenFillStatus';
import type {
  ClinicalFillRequest,
  ClinicalRetryToken,
  ClinicalStageResult,
} from '../contracts/clinicalStageResult';
import { isConfirmedRayenCensusHandoff } from './rayenCensusPersistenceGuard';

interface UseRayenClinicalFillRetryInput {
  currentRecord: DailyRecord | null | undefined;
  currentRecordRef: MutableRefObject<DailyRecord | null | undefined>;
  runClinicalStage: (source: ClinicalFillRequest) => Promise<ClinicalStageResult>;
  retryTokenRef: MutableRefObject<ClinicalRetryToken | null>;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  onStart?: (record: DailyRecord) => boolean | void;
}

export const useRayenClinicalFillRetry = ({
  currentRecord,
  currentRecordRef,
  runClinicalStage,
  retryTokenRef,
  setState,
  onStart,
}: UseRayenClinicalFillRetryInput) =>
  useCallback(async (): Promise<void> => {
    const activeRecord = currentRecordRef.current ?? currentRecord;
    let retryRequest = retryTokenRef.current;
    if (retryRequest) {
      const retrySource = retryRequest.source;
      const retryRecord = 'record' in retrySource ? retrySource.record : retrySource;
      const retryRunId = isConfirmedRayenCensusHandoff(retrySource)
        ? retrySource.runId
        : retryRecord.rayenSync?.runId;
      const matchesActiveRun =
        activeRecord?.date === retryRecord.date &&
        activeRecord?.rayenSync?.runId === retryRunId;
      if (!matchesActiveRun) {
        retryTokenRef.current = null;
        retryRequest = null;
      } else if (activeRecord) {
        retryRequest = {
          ...retryRequest,
          source:
            'record' in retrySource
              ? { ...retrySource, record: activeRecord }
              : activeRecord,
        };
        retryTokenRef.current = retryRequest;
      }
    }
    const record = activeRecord;
    if (!record?.rayenSync?.runId || record.rayenSync.status !== 'applied') {
      setState(prev => ({
        ...prev,
        error: 'No hay una sincronización clínica pendiente que se pueda reanudar.',
      }));
      return;
    }
    if (!resetRayenFillProgress()) {
      setState(prev => ({
        ...prev,
        error: 'La revisión clínica ya está en curso. Espera a que termine.',
      }));
      return;
    }
    if (onStart?.(record) === false) {
      setState(prev => ({
        ...prev,
        error: 'Hay otra sincronización en curso. Espera a que termine antes de reintentar.',
      }));
      return;
    }
    setState(prev => ({ ...prev, isSyncing: true, error: null }));
    await runClinicalStage(retryRequest ?? record);
  }, [currentRecord, currentRecordRef, onStart, retryTokenRef, runClinicalStage, setState]);
