import { useMemo, type MutableRefObject } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import {
  fetchAnalyticsSpecialtyReclassifications,
  saveAnalyticsSpecialtyReclassification,
  type SaveAnalyticsSpecialtyReclassificationRequest,
} from '@/features/analytics/services/analyticsSpecialtyReclassificationService';
import {
  buildVerifiedReclassificationsStamp,
  filterReclassificationsForRange,
  isReclassificationsQueryVerified,
  resolveReclassificationsError,
} from '@/features/analytics/controllers/minsalStatsVerificationController';
import type { SpecialtyReclassification } from '@/features/analytics/types/minsalTypes';

interface UseMinsalSpecialtyReclassificationsParams {
  hospitalId: string;
  startDate: string;
  endDate: string;
  previousPeriodStart: string;
  manualRefreshKeysRef: MutableRefObject<Set<string>>;
}

export interface UseMinsalSpecialtyReclassificationsResult {
  reclassificationsQueryKey: ReturnType<typeof queryKeys.analytics.specialtyReclassifications>;
  saveReclassificationMutationKey: ReturnType<
    typeof queryKeys.analytics.saveSpecialtyReclassification
  >;
  isLoading: boolean;
  allPeriodReclassifications: SpecialtyReclassification[];
  reclassifications: SpecialtyReclassification[];
  reclassificationsError: string | null;
  isReclassificationsVerified: boolean;
  currentVerifiedStamp: string | null;
  hasReclassificationsSettledOnce: boolean;
  saveReclassification: (
    request: Omit<SaveAnalyticsSpecialtyReclassificationRequest, 'hospitalId'>
  ) => Promise<void>;
  isSavingReclassification: boolean;
}

export const useMinsalSpecialtyReclassifications = ({
  hospitalId,
  startDate,
  endDate,
  previousPeriodStart,
  manualRefreshKeysRef,
}: UseMinsalSpecialtyReclassificationsParams): UseMinsalSpecialtyReclassificationsResult => {
  const queryClient = useQueryClient();

  const reclassificationsQueryKey = useMemo(
    () => queryKeys.analytics.specialtyReclassifications(hospitalId, previousPeriodStart, endDate),
    [hospitalId, previousPeriodStart, endDate]
  );

  const reclassificationsQuery = useQuery({
    queryKey: reclassificationsQueryKey,
    queryFn: () =>
      fetchAnalyticsSpecialtyReclassifications(previousPeriodStart, endDate, hospitalId),
    staleTime: 2 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });

  const saveReclassificationMutationKey = useMemo(
    () => queryKeys.analytics.saveSpecialtyReclassification(hospitalId),
    [hospitalId]
  );
  const pendingReclassificationSaves = useIsMutating({
    mutationKey: saveReclassificationMutationKey,
  });

  const saveReclassificationMutation = useMutation({
    mutationKey: saveReclassificationMutationKey,
    mutationFn: (request: Omit<SaveAnalyticsSpecialtyReclassificationRequest, 'hospitalId'>) =>
      saveAnalyticsSpecialtyReclassification({ ...request, hospitalId }),
    onSettled: async () => {
      const reclassificationsPrefix =
        queryKeys.analytics.specialtyReclassificationsByHospital(hospitalId);
      const remoteStatsPrefix = queryKeys.analytics.remoteStatsByHospital(hospitalId);

      manualRefreshKeysRef.current.add('*');
      try {
        await Promise.all([
          queryClient.cancelQueries({ queryKey: reclassificationsPrefix }),
          queryClient.cancelQueries({ queryKey: remoteStatsPrefix }),
        ]);
        await queryClient.invalidateQueries(
          { queryKey: reclassificationsPrefix },
          { cancelRefetch: true }
        );
        await queryClient.invalidateQueries(
          { queryKey: remoteStatsPrefix },
          { cancelRefetch: true }
        );
      } finally {
        manualRefreshKeysRef.current.delete('*');
      }
    },
  });

  const isSavingReclassification =
    saveReclassificationMutation.isPending || pendingReclassificationSaves > 0;
  const reclassificationsQueryState = queryClient.getQueryState(reclassificationsQueryKey);
  const isReclassificationsInvalidated = reclassificationsQueryState?.isInvalidated ?? false;
  const reclassificationsUpdateCount = reclassificationsQueryState?.dataUpdateCount ?? 0;
  const reclassificationsErrorCount = reclassificationsQueryState?.errorUpdateCount ?? 0;

  const allPeriodReclassifications = useMemo(
    () => reclassificationsQuery.data ?? [],
    [reclassificationsQuery.data]
  );
  const reclassifications = useMemo(
    () => filterReclassificationsForRange(allPeriodReclassifications, startDate, endDate),
    [allPeriodReclassifications, endDate, startDate]
  );

  const reclassificationsError = useMemo(
    () =>
      resolveReclassificationsError(reclassificationsQuery.error, reclassificationsQuery.isPaused),
    [reclassificationsQuery.error, reclassificationsQuery.isPaused]
  );

  const isReclassificationsVerified = isReclassificationsQueryVerified({
    status: reclassificationsQuery.status,
    error: reclassificationsQuery.error,
    isFetching: reclassificationsQuery.isFetching,
    isPaused: reclassificationsQuery.isPaused,
    isInvalidated: isReclassificationsInvalidated,
    failureCount: reclassificationsQuery.failureCount,
    isSavingReclassification,
  });

  const currentVerifiedStamp = useMemo(
    () =>
      isReclassificationsVerified && reclassificationsUpdateCount > 0
        ? buildVerifiedReclassificationsStamp(
            reclassificationsUpdateCount,
            reclassificationsQuery.dataUpdatedAt,
            reclassifications
          )
        : null,
    [
      isReclassificationsVerified,
      reclassifications,
      reclassificationsQuery.dataUpdatedAt,
      reclassificationsUpdateCount,
    ]
  );

  const hasReclassificationsSettledOnce =
    reclassificationsUpdateCount > 0 ||
    reclassificationsErrorCount > 0 ||
    reclassificationsQuery.isPaused;

  return {
    reclassificationsQueryKey,
    saveReclassificationMutationKey,
    isLoading: reclassificationsQuery.isLoading,
    allPeriodReclassifications,
    reclassifications,
    reclassificationsError,
    isReclassificationsVerified,
    currentVerifiedStamp,
    hasReclassificationsSettledOnce,
    saveReclassification: saveReclassificationMutation.mutateAsync,
    isSavingReclassification,
  };
};
