/**
 * React Query Configuration
 * Centralized setup for TanStack Query with optimized defaults for Firebase.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Default query client with optimized settings for a healthcare app.
 * 
 * Settings:
 * - staleTime: 5 minutes (data considered fresh for 5 min)
 * - gcTime: 30 minutes (keep unused data in cache for 30 min)
 * - retry: 2 attempts for failed queries
 * - refetchOnWindowFocus: only refetch stale data when tab becomes active
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Data is considered fresh for 5 minutes
            staleTime: 5 * 60 * 1000,

            // Keep unused data in cache for 30 minutes
            gcTime: 30 * 60 * 1000,

            // Retry failed queries 2 times
            retry: 2,

            // Only refetch if data is stale when window gains focus
            refetchOnWindowFocus: 'always',

            // Don't refetch on mount if data is fresh
            refetchOnMount: true,

            // Refetch on reconnect if data is stale
            refetchOnReconnect: 'always',
        },
        mutations: {
            // Retry mutations once on failure
            retry: 1,
        },
    },
});

/**
 * Query keys factory for consistent cache key management.
 * Use these to ensure proper cache invalidation.
 * 
 * @example
 * queryKeys.dailyRecord.byDate('2024-12-23')
 * queryKeys.dailyRecord.all
 */
export const queryKeys = {
    dailyRecord: {
        all: ['dailyRecord'] as const,
        byDate: (date: string) => ['dailyRecord', date] as const,
        byMonth: (year: number, month: number) => ['dailyRecord', 'month', year, month] as const,
        lists: () => ['dailyRecord', 'list'] as const,
    },
    staff: {
        all: ['staff'] as const,
        catalog: () => ['staff', 'catalog'] as const,
    },
    audit: {
        all: ['audit'] as const,
        logs: (filters?: { startDate?: string; endDate?: string }) =>
            ['audit', 'logs', filters] as const,
    },
    user: {
        all: ['user'] as const,
        current: () => ['user', 'current'] as const,
        settings: () => ['user', 'settings'] as const,
    },
} as const;
