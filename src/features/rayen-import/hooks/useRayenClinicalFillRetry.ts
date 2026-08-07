import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenImportState } from './rayenImportState';
import { resetRayenFillProgress } from './useRayenFillStatus';
import type { ConfirmedRayenCensusHandoff } from './rayenCensusPersistenceGuard';

interface UseRayenClinicalFillRetryInput {
  currentRecord: DailyRecord | null | undefined;
  currentRecordRef: MutableRefObject<DailyRecord | null | undefined>;
  fillClinicalData: (source: DailyRecord | ConfirmedRayenCensusHandoff) => Promise<void>;
  setState: Dispatch<SetStateAction<RayenImportState>>;
}

export const useRayenClinicalFillRetry = ({
  currentRecord,
  currentRecordRef,
  fillClinicalData,
  setState,
}: UseRayenClinicalFillRetryInput) =>
  useCallback(async (): Promise<void> => {
    const record = currentRecordRef.current ?? currentRecord;
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
    setState(prev => ({ ...prev, isSyncing: true, error: null }));
    await fillClinicalData(record);
  }, [currentRecord, currentRecordRef, fillClinicalData, setState]);
