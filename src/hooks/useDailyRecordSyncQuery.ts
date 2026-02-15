/**
 * useDailyRecordSyncQuery Hook
 * Replaces useDailyRecordSync logic with TanStack Query.
 * Provides the same interface for compatibility.
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  useDailyRecordQuery,
  useSaveDailyRecordMutation,
  usePatchDailyRecordMutation,
  useInitializeDailyRecordMutation,
  useDeleteDailyRecordMutation,
  useGenerateDemoMutation,
} from './useDailyRecordQuery';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import { SyncStatus, UseDailyRecordSyncResult, DailyRecordPatch } from './useDailyRecordTypes';
import { DailyRecord } from '@/types';
import { useRepositories } from '@/services/RepositoryContext';
import { useNotification } from '@/context/UIContext';
import { useVersion } from '@/context/VersionContext';
import { resolveSaveErrorFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';

export const useDailyRecordSyncQuery = (
  currentDateString: string,
  _isOfflineMode: boolean = false, // Handled implicitly by TanStack Query & Repository
  _isFirebaseConnected: boolean = false
): UseDailyRecordSyncResult => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const { checkVersion } = useVersion();

  // 1. Fetching
  const {
    data: record,
    dataUpdatedAt,
    refetch,
  } = useDailyRecordQuery(currentDateString, _isOfflineMode, _isFirebaseConnected);

  // Monitor version in incoming records
  useEffect(() => {
    if (record?.schemaVersion) {
      checkVersion(record.schemaVersion);
    }
  }, [record, checkVersion]);

  // 2. Mutations
  const saveMutation = useSaveDailyRecordMutation();
  const patchMutation = usePatchDailyRecordMutation(currentDateString);
  const initMutation = useInitializeDailyRecordMutation();
  const deleteMutation = useDeleteDailyRecordMutation();
  const demoMutation = useGenerateDemoMutation();
  const pendingRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingRefetchTimeout = useCallback(() => {
    if (pendingRefetchTimeoutRef.current !== null) {
      clearTimeout(pendingRefetchTimeoutRef.current);
      pendingRefetchTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearPendingRefetchTimeout, [clearPendingRefetchTimeout]);

  // 3. Status Mapping
  const syncStatus = useMemo(
    (): SyncStatus =>
      resolveDailyRecordSyncStatus([
        {
          isPending: saveMutation.isPending,
          isError: saveMutation.isError,
          isSuccess: saveMutation.isSuccess,
        },
        {
          isPending: patchMutation.isPending,
          isError: patchMutation.isError,
          isSuccess: patchMutation.isSuccess,
        },
        {
          isPending: initMutation.isPending,
          isError: initMutation.isError,
          isSuccess: initMutation.isSuccess,
        },
        {
          isPending: deleteMutation.isPending,
          isError: deleteMutation.isError,
          isSuccess: deleteMutation.isSuccess,
        },
        {
          isPending: demoMutation.isPending,
          isError: demoMutation.isError,
          isSuccess: demoMutation.isSuccess,
        },
      ]),
    [
      deleteMutation.isError,
      deleteMutation.isPending,
      deleteMutation.isSuccess,
      demoMutation.isError,
      demoMutation.isPending,
      demoMutation.isSuccess,
      initMutation.isError,
      initMutation.isPending,
      initMutation.isSuccess,
      patchMutation.isError,
      patchMutation.isPending,
      patchMutation.isSuccess,
      saveMutation.isError,
      saveMutation.isPending,
      saveMutation.isSuccess,
    ]
  );

  const lastSyncTime = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    [dataUpdatedAt]
  );

  const { error: notifyError, success, warning } = useNotification();

  // 4. Compatibility handlers
  const saveAndUpdate = useCallback(
    async (updatedRecord: DailyRecord) => {
      try {
        await saveMutation.mutateAsync(updatedRecord);
      } catch (err) {
        const feedback = resolveSaveErrorFeedback(err);
        if (feedback) {
          notifyError(feedback.title, feedback.message);

          if (feedback.shouldLog) {
            console.error(feedback.logLabel || '[Sync] Save blocked:', err);
          }

          if (feedback.refetchDelayMs) {
            clearPendingRefetchTimeout();
            pendingRefetchTimeoutRef.current = setTimeout(() => {
              refetch();
              pendingRefetchTimeoutRef.current = null;
            }, feedback.refetchDelayMs);
          }
        }
        throw err;
      }
    },
    [saveMutation, notifyError, refetch, clearPendingRefetchTimeout]
  );

  const patchRecord = useCallback(
    async (partial: DailyRecordPatch) => {
      await patchMutation.mutateAsync(partial);
    },
    [patchMutation]
  );

  const setRecord = useCallback(
    (updater: DailyRecord | null | ((prev: DailyRecord | null) => DailyRecord | null)) => {
      const key = queryKeys.dailyRecord.byDate(currentDateString);
      queryClient.setQueryData(key, updater);
      queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, currentDateString]
  );

  const markLocalChange = useCallback(() => {
    // TanStack Query handles local changes via optimistic updates in mutations.
    // For ad-hoc changes not through mutations, we can manual update cache if needed.
  }, []);

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const createDay = useCallback(
    async (copyFromPrevious: boolean, specificDate?: string) => {
      let prevDate: string | undefined = undefined;

      if (copyFromPrevious) {
        if (specificDate) {
          prevDate = specificDate;
        } else {
          const prevRecord = await dailyRecord.getPreviousDay(currentDateString);
          if (prevRecord) {
            prevDate = prevRecord.date;
          } else {
            warning('No se encontró registro anterior', 'No hay datos del día previo para copiar.');
            return;
          }
        }
      }

      await initMutation.mutateAsync({ date: currentDateString, copyFromDate: prevDate });
      const sourceMsg = prevDate ? `Copiado desde ${prevDate}` : 'Registro en blanco';
      success('Día creado', sourceMsg);
    },
    [currentDateString, initMutation, success, warning, dailyRecord]
  );

  const resetDay = useCallback(async () => {
    await deleteMutation.mutateAsync(currentDateString);
    success('Registro eliminado', 'El registro del día ha sido eliminado.');
  }, [currentDateString, deleteMutation, success]);

  const generateDemo = useCallback(async () => {
    await demoMutation.mutateAsync(currentDateString);
    success('Demo Generada', 'Se han cargado datos de prueba.');
  }, [currentDateString, demoMutation, success]);

  return {
    record: record ?? null,
    setRecord,
    syncStatus,
    lastSyncTime,
    saveAndUpdate,
    patchRecord,
    markLocalChange,
    refresh,
    createDay,
    resetDay,
    generateDemo,
  };
};
