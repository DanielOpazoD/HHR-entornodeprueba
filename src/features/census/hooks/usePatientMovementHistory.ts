import { useEffect, useState } from 'react';
import {
  getPatientMovementHistoryDetailed,
  type PatientHistoryResult,
} from '@/features/census/services/patientHistoryService';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

const patientHistoryLogger = createScopedLogger('PatientHistoryModal');

interface UsePatientMovementHistoryParams {
  isOpen: boolean;
  patientRut: string;
  admissionDate?: string;
  throughDate?: string;
}

export interface UsePatientMovementHistoryResult {
  history: PatientHistoryResult | null;
  isLoading: boolean;
  error: string | null;
  isPartial: boolean;
  hasPeriod: boolean;
  showFullHistory: boolean;
  toggleFullHistory: () => void;
  retry: () => void;
}

export const usePatientMovementHistory = ({
  isOpen,
  patientRut,
  admissionDate,
  throughDate,
}: UsePatientMovementHistoryParams): UsePatientMovementHistoryResult => {
  const [history, setHistory] = useState<PatientHistoryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPartial, setIsPartial] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [fullHistoryContext, setFullHistoryContext] = useState<string | null>(null);

  const contextKey = JSON.stringify([patientRut, admissionDate, throughDate]);
  const showFullHistory = fullHistoryContext === contextKey;
  const hasPeriod = Boolean(admissionDate && throughDate);

  if (
    useChangedOnRender([
      isOpen,
      patientRut,
      retryCount,
      admissionDate,
      throughDate,
      showFullHistory,
    ])
  ) {
    if (!isOpen) setFullHistoryContext(null);
    if (isOpen && patientRut) {
      setIsLoading(true);
      setError(null);
      setHistory(null);
      setIsPartial(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    if (isOpen && patientRut) {
      const loadData = async () => {
        try {
          const result = await getPatientMovementHistoryDetailed(patientRut, {
            signal,
            ...(admissionDate && throughDate && !showFullHistory
              ? { dateRange: { startDate: admissionDate, endDate: throughDate } }
              : { forceFullRemoteHydration: true }),
          });
          if (signal.aborted) return;
          setHistory(result.history);
          setIsPartial(result.source === 'local');
          if (!result.history) {
            setError(
              result.source === 'local'
                ? 'No se pudo comprobar el historial en el servidor. No hay movimientos disponibles localmente.'
                : 'No se encontró historial para este paciente.'
            );
          }
        } catch (err) {
          if (signal.aborted) return;
          patientHistoryLogger.warn('Error fetching patient history', err);
          setError('Error al cargar el historial.');
        } finally {
          if (!signal.aborted) setIsLoading(false);
        }
      };

      void loadData();
    }
    return () => {
      controller.abort();
    };
  }, [isOpen, patientRut, retryCount, admissionDate, throughDate, showFullHistory]);

  return {
    history,
    isLoading,
    error,
    isPartial,
    hasPeriod,
    showFullHistory,
    toggleFullHistory: () => setFullHistoryContext(showFullHistory ? null : contextKey),
    retry: () => setRetryCount(value => value + 1),
  };
};
