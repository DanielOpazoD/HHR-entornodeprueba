import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { queryKeys } from '@/config/queryClient';
import { useRepositories } from '@/services/RepositoryContext';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  applyOptimisticDailyRecordPatch,
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  getDailyRecordLastRemoteConfirmedAt,
  markDailyRecordRemoteConfirmed,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { registerPendingDailyRecordPatch } from '@/hooks/controllers/dailyRecordPendingPatchController';
import {
  assertHydratedRemotePatchCanProceed,
  ensureFreshClinicalPatchMutation,
  patchDailyRecordWithCompatibility,
  releasePendingPatchAfterFallbackTtl,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  createDailyRecordPatchBaseRecordRegistry,
  forgetDailyRecordPatchBaseRecord,
  getDailyRecordPatchBaseRecord,
  rememberDailyRecordPatchBaseRecord,
  type DailyRecordPatchBaseRecordRegistry,
} from '@/hooks/controllers/dailyRecordPatchBaseRecordController';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';

type PatchMutationInput =
  | DailyRecordPatch
  | {
      partial: DailyRecordPatch;
      options?: PartialUpdateDailyRecordOptions;
    };

const resolveInput = (
  input: PatchMutationInput
): { partial: DailyRecordPatch; options?: PartialUpdateDailyRecordOptions } => {
  if (
    'partial' in input &&
    input.partial !== null &&
    typeof input.partial === 'object' &&
    !Array.isArray(input.partial)
  ) {
    return input as {
      partial: DailyRecordPatch;
      options?: PartialUpdateDailyRecordOptions;
    };
  }
  return { partial: input as DailyRecordPatch };
};

const mutationTails = new Map<string, Promise<void>>();

const acquireMutationTurn = async (date: string): Promise<() => void> => {
  const previousTurn = mutationTails.get(date) ?? Promise.resolve();
  let releaseCurrentTurn!: () => void;
  const currentTurn = new Promise<void>(resolve => {
    releaseCurrentTurn = resolve;
  });
  mutationTails.set(date, currentTurn);
  await previousTurn;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrentTurn();
    if (mutationTails.get(date) === currentTurn) mutationTails.delete(date);
  };
};

const isNewerThan = (candidate: DailyRecord, baseline: DailyRecord): boolean =>
  toRecordTimestamp(candidate.lastUpdated) > toRecordTimestamp(baseline.lastUpdated);

/** Granular daily-record writes, serialized per date and confirmed remotely when required. */
export const usePatchDailyRecordMutation = (date: string) => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const patchBaseRecordsRef = useRef<DailyRecordPatchBaseRecordRegistry | null>(null);
  if (patchBaseRecordsRef.current == null) {
    patchBaseRecordsRef.current = createDailyRecordPatchBaseRecordRegistry();
  }
  const patchBaseRecords = patchBaseRecordsRef.current;

  return useMutation({
    mutationFn: async (input: PatchMutationInput) => {
      const { partial, options } = resolveInput(input);
      const baseRecord = getDailyRecordPatchBaseRecord(patchBaseRecords, partial);
      const result = await patchDailyRecordWithCompatibility(
        dailyRecord,
        date,
        partial,
        baseRecord || options ? { ...options, ...(baseRecord ? { baseRecord } : {}) } : undefined
      );
      return { partial, options, result };
    },
    onMutate: async input => {
      const releaseMutationTurn = await acquireMutationTurn(date);
      try {
        const { partial, options } = resolveInput(input);
        const previousRecordBeforeFreshness = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        const remoteConfirmedAtBeforeMutation = getDailyRecordLastRemoteConfirmedAt(date);
        const freshness = await ensureFreshClinicalPatchMutation(date, {
          dailyRecord,
          queryClient,
        });
        assertHydratedRemotePatchCanProceed({
          date,
          attemptedPatch: partial,
          previousRecord: previousRecordBeforeFreshness,
          freshness,
          remoteConfirmedAtBeforeMutation,
        });
        rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, freshness.record);

        await queryClient.cancelQueries({ queryKey: queryKeys.dailyRecord.byDate(date) });
        const isRemoteAuthorityFirst = options?.requireRemoteAuthorityFirst === true;
        const unregisterPendingPatch = isRemoteAuthorityFirst
          ? () => {}
          : registerPendingDailyRecordPatch(date, partial);
        const previousRecord = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        const optimisticApplied = Boolean(previousRecord && !isRemoteAuthorityFirst);

        if (previousRecord && optimisticApplied) {
          setDailyRecordQueryData(
            queryClient,
            date,
            applyOptimisticDailyRecordPatch(previousRecord, partial)
          );
        }
        return { previousRecord, unregisterPendingPatch, optimisticApplied, releaseMutationTurn };
      } catch (error) {
        releaseMutationTurn();
        throw error;
      }
    },
    onError: (_error, input, context) => {
      if (context?.optimisticApplied && context.previousRecord) {
        setDailyRecordQueryData(queryClient, date, context.previousRecord);
      }
      forgetDailyRecordPatchBaseRecord(patchBaseRecords, resolveInput(input).partial);
    },
    onSuccess: (payload, _input, context) => {
      if (isDailyRecordWriteRejectedResult(payload.result)) {
        if (context?.optimisticApplied) {
          setDailyRecordQueryData(queryClient, date, context.previousRecord ?? null);
        }
        return;
      }
      if (!payload.result?.updatedRemotely) return;
      const confirmedRecord = payload.result.confirmedRecord;
      const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(date)
      )?.record;
      if (confirmedRecord && cachedRecord && isNewerThan(cachedRecord, confirmedRecord)) return;
      if (confirmedRecord) setDailyRecordQueryData(queryClient, date, confirmedRecord);
      const currentRecord = confirmedRecord ?? cachedRecord;
      if (!currentRecord) return;
      markDailyRecordRemoteConfirmed(date, {
        source: 'write',
        remoteLastUpdated: currentRecord.lastUpdated,
        confirmedRecord: currentRecord,
      });
    },
    onSettled: (payload, error, input, context) => {
      context?.releaseMutationTurn();
      const partial = resolveInput(input).partial;
      if (!context?.unregisterPendingPatch) return;
      if (error || isDailyRecordWriteRejectedResult(payload?.result)) {
        context.unregisterPendingPatch();
        forgetDailyRecordPatchBaseRecord(patchBaseRecords, partial);
        return;
      }
      forgetDailyRecordPatchBaseRecord(patchBaseRecords, partial);
      releasePendingPatchAfterFallbackTtl(context.unregisterPendingPatch);
    },
  });
};
