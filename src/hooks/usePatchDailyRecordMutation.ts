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
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import {
  canRebaseIntentionalBedClear,
  rebaseIntentionalBedClear,
} from '@/hooks/controllers/intentionalBedClearController';
import {
  getDailyRecordPatchMutationKey,
  type DailyRecordPatchMutationVariables,
} from '@/hooks/controllers/dailyRecordPatchMutationController';

type PatchMutationInput = DailyRecordPatchMutationVariables;

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
    mutationKey: getDailyRecordPatchMutationKey(date),
    mutationFn: async (input: PatchMutationInput) => {
      const { partial, options } = resolveInput(input);
      const baseRecord = getDailyRecordPatchBaseRecord(patchBaseRecords, partial);
      const buildOptions = (record: DailyRecord | undefined) => ({
        ...options,
        ...(record ? { baseRecord: record } : {}),
        ...(options?.intentionalBedClear && record
          ? {
              intentionalBedClear: rebaseIntentionalBedClear(options.intentionalBedClear, record),
            }
          : {}),
      });
      const write = (record: DailyRecord | undefined) =>
        patchDailyRecordWithCompatibility(
          dailyRecord,
          date,
          partial,
          record || options ? buildOptions(record) : undefined
        );

      let result;
      try {
        result = await write(baseRecord);
      } catch (error) {
        if (!(error instanceof ConcurrencyError) || !options?.intentionalBedClear) {
          throw error;
        }

        const latestRecord = await dailyRecord.getAuthoritativeForDate(date);
        if (!canRebaseIntentionalBedClear(options.intentionalBedClear, latestRecord)) {
          throw new ConcurrencyError(
            'La cama cambió desde que se confirmó la limpieza. Recargue antes de intentarlo nuevamente.'
          );
        }
        setDailyRecordQueryData(queryClient, date, latestRecord);
        rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, latestRecord);
        result = await write(latestRecord);
      }
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
        let freshRecord: DailyRecord | null;
        if (options?.intentionalBedClear) {
          // The callable is the definitive authority: it validates both the expected
          // version and confirmed occupant before applying a destructive clear. Use
          // the record currently shown to the user for the first attempt so the
          // common path does not pay for a redundant server read. A real CAS conflict
          // still triggers the existing authoritative reload and single safe retry in
          // mutationFn above.
          freshRecord = previousRecordBeforeFreshness ?? null;
          if (!canRebaseIntentionalBedClear(options.intentionalBedClear, freshRecord)) {
            throw new ConcurrencyError(
              'La cama cambió desde que se confirmó la limpieza. Recargue antes de intentarlo nuevamente.'
            );
          }
        } else {
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
          freshRecord = freshness.record;
        }
        rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, freshRecord);

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
