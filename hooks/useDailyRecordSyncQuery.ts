/**
 * useDailyRecordSyncQuery Hook
 * Replaces useDailyRecordSync logic with TanStack Query.
 * Provides the same interface for compatibility.
 */

import { useCallback, useMemo } from 'react';
import { useDailyRecordQuery, useSaveDailyRecordMutation, usePatchDailyRecordMutation } from './useDailyRecordQuery';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import { SyncStatus, UseDailyRecordSyncResult } from './useDailyRecordTypes';
import { DailyRecord } from '../types';
import { DailyRecordPatchLoose } from './useDailyRecordTypes';
import { useNotification } from '../context/UIContext';
import { useVersion } from '../context/VersionContext';
import { ConcurrencyError } from '../services/storage/firestoreService';
import { DataRegressionError, VersionMismatchError } from '../utils/integrityGuard';
import { useEffect } from 'react';

export const useDailyRecordSyncQuery = (
    currentDateString: string,
    _isOfflineMode: boolean = false, // Handled implicitly by TanStack Query & Repository
    _isFirebaseConnected: boolean = false
): UseDailyRecordSyncResult => {
    const queryClient = useQueryClient();
    const { checkVersion } = useVersion();

    // 1. Fetching
    const {
        data: record,
        status,
        dataUpdatedAt,
        fetchStatus,
        refetch
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

    // 3. Status Mapping
    const syncStatus = useMemo((): SyncStatus => {
        if (saveMutation.isPending || patchMutation.isPending) return 'saving';
        if (saveMutation.isError || patchMutation.isError) return 'error';
        if (saveMutation.isSuccess || patchMutation.isSuccess) return 'saved';
        return 'idle';
    }, [saveMutation.isPending, patchMutation.isPending, saveMutation.isError, patchMutation.isError, saveMutation.isSuccess, patchMutation.isSuccess]);

    const lastSyncTime = useMemo(() =>
        dataUpdatedAt ? new Date(dataUpdatedAt) : null,
        [dataUpdatedAt]);

    const { error: notifyError } = useNotification();

    // 4. Compatibility handlers
    const saveAndUpdate = useCallback(async (updatedRecord: DailyRecord) => {
        try {
            await saveMutation.mutateAsync(updatedRecord);
        } catch (err) {
            if (err instanceof ConcurrencyError) {
                notifyError('Conflicto de Edición', err.message);
                // Auto-refresh after 2 seconds to show new data
                setTimeout(() => {
                    refetch();
                }, 2000);
            } else if (err instanceof DataRegressionError) {
                notifyError('Protección de Datos', err.message);
                console.error('[Sync] Data regression blocked:', err);
                // Suggest a refresh since remote data is better
                setTimeout(() => {
                    refetch();
                }, 3000);
            } else if (err instanceof VersionMismatchError) {
                notifyError('Versión de Datos Antigua', err.message);
                console.error('[Sync] Version mismatch blocked save:', err);
                // No auto-refetch here because it might lose current changes without warning? 
                // Actually, a refetch is better than being stuck.
                setTimeout(() => refetch(), 5000);
            }
            throw err;
        }
    }, [saveMutation, notifyError, refetch]);

    const patchRecord = useCallback(async (partial: DailyRecordPatchLoose) => {
        await patchMutation.mutateAsync(partial);
    }, [patchMutation]);

    const setRecord = useCallback((updater: DailyRecord | null | ((prev: DailyRecord | null) => DailyRecord | null)) => {
        const key = queryKeys.dailyRecord.byDate(currentDateString);
        queryClient.setQueryData(key, updater);
        queryClient.invalidateQueries({ queryKey: key });
    }, [queryClient, currentDateString]);

    const markLocalChange = useCallback(() => {
        // TanStack Query handles local changes via optimistic updates in mutations.
        // For ad-hoc changes not through mutations, we can manual update cache if needed.
    }, []);

    const refresh = useCallback(() => {
        refetch();
    }, [refetch]);

    return {
        record: record ?? null,
        setRecord,
        syncStatus,
        lastSyncTime,
        saveAndUpdate,
        patchRecord,
        markLocalChange,
        refresh
    };
};
