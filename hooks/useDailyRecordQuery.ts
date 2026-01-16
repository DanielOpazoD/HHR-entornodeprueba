/**
 * useDailyRecordQuery Hook
 * React Query wrapper for fetching daily records with caching.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import { DailyRecord } from '../types';
import {
    getForDate,
    save,
    updatePartial,
    subscribe
} from '../services/repositories/DailyRecordRepository';
import { useEffect } from 'react';
import { DailyRecordPatchLoose } from './useDailyRecordTypes';
import { applyPatches } from '../utils/patchUtils';

/**
 * Hook for fetching a daily record by date with React Query.
 * Provides automatic caching and background refetching.
 * 
 * @param date - Date string in YYYY-MM-DD format
 * @param isOfflineMode - Whether the app is forced to offline
 * @param isFirebaseConnected - Whether Firebase Auth is ready
 * @returns Query result with data, loading, and error states
 */
export const useDailyRecordQuery = (
    date: string,
    isOfflineMode: boolean = false,
    isFirebaseConnected: boolean = false
) => {
    const queryClient = useQueryClient();

    const queryKey = queryKeys.dailyRecord.byDate(date);
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            const record = await getForDate(date);
            return record;
        },
        enabled: !!date,
    });

    // Subscribe to real-time updates
    useEffect(() => {
        if (!date || isOfflineMode || !isFirebaseConnected) return;

        const unsubscribe = subscribe(date, (record, hasPendingWrites) => {
            // Only update the query cache if it's not a local echo
            if (!hasPendingWrites) {
                queryClient.setQueryData(
                    queryKeys.dailyRecord.byDate(date),
                    record
                );
            }
        });

        return () => unsubscribe();
    }, [date, queryClient, isOfflineMode, isFirebaseConnected]);

    // Prefetch previous day for faster "copy from previous" functionality
    useEffect(() => {
        if (!date) return;

        // Calculate previous day
        const currentDate = new Date(date + 'T12:00:00'); // Noon to avoid timezone issues
        currentDate.setDate(currentDate.getDate() - 1);
        const prevDate = currentDate.toISOString().split('T')[0];

        // Prefetch in background (low priority)
        queryClient.prefetchQuery({
            queryKey: queryKeys.dailyRecord.byDate(prevDate),
            queryFn: () => getForDate(prevDate),
            staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
        });
    }, [date, queryClient]);

    return query;
};


/**
 * Hook for saving/updating a daily record.
 * Provides optimistic updates and automatic cache invalidation.
 */
export const useSaveDailyRecordMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (record: DailyRecord) => {
            await save(record);
            return record;
        },
        onMutate: async (newRecord) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({
                queryKey: queryKeys.dailyRecord.byDate(newRecord.date)
            });

            // Snapshot the previous value
            const previousRecord = queryClient.getQueryData<DailyRecord>(
                queryKeys.dailyRecord.byDate(newRecord.date)
            );

            // Optimistically update
            queryClient.setQueryData(
                queryKeys.dailyRecord.byDate(newRecord.date),
                newRecord
            );

            // Return context with the previous value
            return { previousRecord };
        },
        onError: (err, newRecord, context) => {
            // Rollback on error
            if (context?.previousRecord) {
                queryClient.setQueryData(
                    queryKeys.dailyRecord.byDate(newRecord.date),
                    context.previousRecord
                );
            }
        },
        onSettled: (record) => {
            // Refetch to ensure we're in sync
            if (record) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.dailyRecord.byDate(record.date)
                });
            }
        },
    });
};

/**
 * Hook for partial updates (patches).
 * Provides granular optimistic updates for better performance.
 * 
 * Flow for "Atomicity & Sync":
 * 1. onMutate: Cancels refetches, snapshots old data, and applies patches locally 
 *    using dot-notation paths. This gives immediate UI feedback.
 * 2. mutationFn: Sends only the patch to the server (DailyRecordRepository.updatePartial).
 * 3. Firestore: Merges the patch server-side.
 * 4. Real-time Subscription: The query observer in useDailyRecordQuery receives the 
 *    update from Firestore and updates the cache, ensuring the UI aligns with 
 *    the final server state (eventual consistency).
 */
export const usePatchDailyRecordMutation = (date: string) => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (partial: DailyRecordPatchLoose) => {
            await updatePartial(date, partial);
            return partial;
        },
        onMutate: async (partial) => {
            await queryClient.cancelQueries({
                queryKey: queryKeys.dailyRecord.byDate(date)
            });

            const previousRecord = queryClient.getQueryData<DailyRecord>(
                queryKeys.dailyRecord.byDate(date)
            );

            if (previousRecord) {
                const updatedRecord = applyPatches(previousRecord, partial);
                updatedRecord.lastUpdated = new Date().toISOString();

                queryClient.setQueryData(
                    queryKeys.dailyRecord.byDate(date),
                    updatedRecord
                );
            }

            return { previousRecord };
        },
        onError: (err, partial, context) => {
            if (context?.previousRecord) {
                queryClient.setQueryData(
                    queryKeys.dailyRecord.byDate(date),
                    context.previousRecord
                );
            }
        },
        // Note: We don't invalidate queries here because the Firestore subscription
        // will automatically update the cache when the write completes.
        // Forcing invalidation here can cause "echo" effects where the UI flickers
        // between states as it refetches data that might still be propagating.
        onSettled: () => {
            // No-op - let Firestore subscription handle sync
        },
    });
};

/**
 * Hook to prefetch a daily record.
 * Useful for prefetching next/previous day's data.
 */
export const usePrefetchDailyRecord = () => {
    const queryClient = useQueryClient();

    return async (date: string) => {
        await queryClient.prefetchQuery({
            queryKey: queryKeys.dailyRecord.byDate(date),
            queryFn: () => getForDate(date),
        });
    };
};

/**
 * Hook to invalidate daily record cache.
 * Call this after external updates.
 */
export const useInvalidateDailyRecord = () => {
    const queryClient = useQueryClient();

    return (date?: string) => {
        if (date) {
            queryClient.invalidateQueries({
                queryKey: queryKeys.dailyRecord.byDate(date)
            });
        } else {
            queryClient.invalidateQueries({
                queryKey: queryKeys.dailyRecord.all
            });
        }
    };
};
