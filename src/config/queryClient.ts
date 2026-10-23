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
 * - tab return, mount and reconnect refetch only stale data (older than its staleTime,
 *   invalidated or failed); a query that must re-check even fresh data opts in with
 *   'always' (see useDailyRecordQuery)
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

      // Refetch on tab return only when the data is stale
      refetchOnWindowFocus: true,

      // Don't refetch on mount if data is fresh
      refetchOnMount: true,

      // Refetch on reconnect only when the data is stale
      refetchOnReconnect: true,
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
  existingDays: {
    all: ['existingDays'] as const,
    byMonth: (year: number, monthZeroBased: number) =>
      ['existingDays', year, monthZeroBased] as const,
  },
  staff: {
    all: ['staff'] as const,
    catalog: () => ['staff', 'catalog'] as const,
  },
  clinicalDocuments: {
    /** Census badges: which beds have clinical documents, and how many are drafts. */
    presence: ['clinicalDocuments', 'presenceByBed'] as const,
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
  analytics: {
    all: ['analytics'] as const,
    recordsRange: (startDate: string, endDate: string) =>
      ['analytics', 'recordsRange', startDate, endDate] as const,
    remoteStats: (hospitalId: string, startDate: string, endDate: string) =>
      ['analytics', 'remoteStats', hospitalId, startDate, endDate] as const,
    specialtyReclassifications: (hospitalId: string, startDate: string, endDate: string) =>
      ['analytics', 'specialtyReclassifications', hospitalId, startDate, endDate] as const,
  },
  transfers: {
    all: ['transfers'] as const,
    activeByBed: (bedId: string) => ['transfers', 'activeByBed', bedId] as const,
    activeByPatientRut: (rut: string) => ['transfers', 'activeByPatientRut', rut] as const,
  },
  laboratory: {
    all: ['laboratory'] as const,
    byPatient: (rut: string) => ['laboratory', 'patient', rut] as const,
  },
} as const;

/**
 * Clears all queries and mutations from the query cache.
 * Must be called on logout to prevent clinical data leakage between sessions.
 */
export const clearQueryCache = (): void => {
  queryClient.clear();
};
