import { useCallback } from 'react';
import type { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type DailyRecordRepository = ReturnType<typeof useRepositories>['dailyRecord'];

/**
 * Accesos al censo que necesita una corrida de sincronización: la versión
 * vigente para el lote clínico, la autoritativa para la estructura y la copia
 * local. Todos dependen solo del repositorio, así que viven fuera del
 * orquestador (que está en el límite de tamaño del módulo) y se leen juntos.
 */
export const useRayenSyncRecordAccess = (dailyRecord: DailyRecordRepository) => {
  const loadFreshClinicalRecord = useCallback(
    async (date: string): Promise<DailyRecord> => {
      const result = await dailyRecord.getForDateWithMeta(date, true);
      if (!result.record)
        throw new Error('La versión vigente del censo todavía no se leyó. Vuelve a intentar.');
      return result.record as DailyRecord;
    },
    [dailyRecord]
  );

  const loadAuthoritativeStructuralRecord = useCallback(
    async (date: string): Promise<DailyRecord> => {
      const record = await dailyRecord.getAuthoritativeForDate(date);
      if (!record)
        throw new Error('La versión confirmada del censo todavía no se leyó. Vuelve a intentar.');
      return record as DailyRecord;
    },
    [dailyRecord]
  );

  const loadLocalStructuralRecord = useCallback(
    (date: string) => dailyRecord.getLocalForDateWithMeta(date),
    [dailyRecord]
  );

  const loadCudyrIdentityContext = useCallback(
    (date: string) => dailyRecord.getAuthoritativeForDate(date),
    [dailyRecord]
  );

  return {
    loadCudyrIdentityContext,
    loadFreshClinicalRecord,
    loadAuthoritativeStructuralRecord,
    loadLocalStructuralRecord,
  };
};
