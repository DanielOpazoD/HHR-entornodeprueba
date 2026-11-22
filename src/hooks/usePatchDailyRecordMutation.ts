import { isClinicalEventsOnlyDailyRecordPatch } from '@/services/repositories/dailyRecordClinicalDomainService';
import { mutationOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { queryKeys } from '@/config/queryClient';
import { useRepositories } from '@/context/RepositoryContext';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  applyOptimisticDailyRecordPatch,
  getDailyRecordQueryKey,
  setAuthoritativeDailyRecordRead,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  didDailyRecordCacheAdvanceBeyondConfirmation,
  setAcknowledgedDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import {
  getDailyRecordLastRemoteConfirmedAt,
  markDailyRecordRemoteConfirmed,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { registerPendingDailyRecordPatch } from '@/hooks/controllers/dailyRecordPendingPatchController';
import {
  assertHydratedRemotePatchCanProceed,
  ensureFreshClinicalPatchMutation,
  releasePendingPatchAfterFallbackTtl,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  createDailyRecordPatchBaseRecordRegistry,
  forgetDailyRecordPatchBaseRecord,
  rememberDailyRecordPatchBaseRecord,
} from '@/hooks/controllers/dailyRecordPatchBaseRecordController';
import {
  getDailyRecordPatchMutationKey,
  type DailyRecordPatchMutationVariables,
} from '@/hooks/controllers/dailyRecordPatchMutationController';
import {
  rebaseLocalProjectionOntoNewerRecord,
  shouldPublishAuthoritativeConflictRecord,
  shouldRollbackOptimisticDailyRecord,
} from '@/hooks/controllers/dailyRecordLocalProjectionController';
import {
  acquireDailyRecordMutationTurn,
  AuthoritativeDailyRecordConflictError,
  capturePatchMutationInput,
  executeDailyRecordPatchWrite,
  isAuthorSessionCurrent,
  requiresRemoteAuthority,
  type PatchMutationInput,
} from '@/hooks/controllers/dailyRecordPatchMutationExecutor';

/** Granular daily-record writes, serialized per date and confirmed remotely when required. */
export const usePatchDailyRecordMutation = (currentDate: string) => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const [patchBaseRecords] = useState(createDailyRecordPatchBaseRecordRegistry);
  const [remoteSelected, setRemoteSelected] = useState(false);
  const options = mutationOptions({
    mutationKey: getDailyRecordPatchMutationKey(currentDate),
    // The repository owns retries; do not replay a rejected decision as a new command.
    retry: false,
    mutationFn: (input: PatchMutationInput) =>
      executeDailyRecordPatchWrite({
        input,
        currentDate,
        dailyRecord,
        patchBaseRecords,
      }),
    onMutate: async input => {
      const { date = currentDate } = input;
      const releaseMutationTurn = await acquireDailyRecordMutationTurn(date);
      try {
        const { partial, options } = input;
        const previousRecordBeforeFreshness = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        const remoteConfirmedAtBeforeMutation = getDailyRecordLastRemoteConfirmedAt(date);
        let freshRecord: DailyRecord | null;
        if (options?.intentionalBedClear) {
          // Optimistic UI is reversible and must not make the durable concurrency decision. The
          // mutation itself independently binds the destructive write to a fresh server snapshot
          // before committing it, and rolls this visual change back on rejection.
          freshRecord = previousRecordBeforeFreshness ?? null;
        } else if (
          options?.optimisticRemoteConfirmed === true &&
          options.requireRemoteAuthorityFirst === true &&
          options.requireAtomicCas === true
        ) {
          // Clinical-crib creation is an exact, reversible command. Start from the census the user
          // sees and let the atomic remote CAS accept or reject that version. This avoids a
          // redundant remote freshness read before the row can appear; rejection still rolls the
          // optimistic row back and never enters the local outbox.
          freshRecord = previousRecordBeforeFreshness ?? null;
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
        // Freshness may advance the cache, but it cannot change the base that authored a patch.
        rememberDailyRecordPatchBaseRecord(
          patchBaseRecords,
          partial,
          options?.baseRecord ??
            (isClinicalEventsOnlyDailyRecordPatch(partial)
              ? (previousRecordBeforeFreshness ?? freshRecord)
              : freshRecord)
        );

        // The session may end before or during the wait below: nothing is painted in either case.
        const skipped = {
          previousRecord: undefined,
          optimisticRecord: undefined,
          unregisterPendingPatch: () => {},
          optimisticApplied: false,
          releaseMutationTurn,
        };
        if (!isAuthorSessionCurrent(input)) return skipped;
        await queryClient.cancelQueries({ queryKey: queryKeys.dailyRecord.byDate(date) });
        if (!isAuthorSessionCurrent(input)) return skipped;
        const isRemoteAuthorityFirst =
          options?.requireRemoteAuthorityFirst === true ||
          isClinicalEventsOnlyDailyRecordPatch(partial);
        const unregisterPendingPatch = isRemoteAuthorityFirst
          ? () => {}
          : registerPendingDailyRecordPatch(date, partial);
        const previousRecord = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        const optimisticApplied = Boolean(
          previousRecord && (!isRemoteAuthorityFirst || options?.optimisticRemoteConfirmed === true)
        );

        let optimisticRecord: DailyRecord | undefined;
        if (previousRecord && optimisticApplied) {
          optimisticRecord = applyOptimisticDailyRecordPatch(previousRecord, partial);
          setDailyRecordQueryData(queryClient, date, optimisticRecord);
        }
        return {
          previousRecord,
          optimisticRecord,
          unregisterPendingPatch,
          optimisticApplied,
          releaseMutationTurn,
        };
      } catch (error) {
        releaseMutationTurn();
        throw error;
      }
    },
    onError: (error, input, context) => {
      const { date = currentDate } = input;
      forgetDailyRecordPatchBaseRecord(patchBaseRecords, input.partial);
      if (!isAuthorSessionCurrent(input)) return;
      if (error instanceof AuthoritativeDailyRecordConflictError) {
        const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        if (
          shouldPublishAuthoritativeConflictRecord(
            cachedRecord,
            context?.optimisticRecord,
            error.authoritativeRecord
          )
        ) {
          setAuthoritativeDailyRecordRead(queryClient, date, error.authoritativeRecord);
        }
      } else if (context?.optimisticApplied && context.previousRecord) {
        const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        if (shouldRollbackOptimisticDailyRecord(cachedRecord, context.optimisticRecord)) {
          setDailyRecordQueryData(queryClient, date, context.previousRecord);
        }
      }
    },
    onSuccess: async (payload, input, context) => {
      const { date = currentDate } = input;
      if (!isAuthorSessionCurrent(input)) return;
      if (isDailyRecordWriteRejectedResult(payload.result)) {
        if (context?.optimisticApplied) {
          const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
            getDailyRecordQueryKey(date)
          )?.record;
          if (shouldRollbackOptimisticDailyRecord(cachedRecord, context.optimisticRecord)) {
            setDailyRecordQueryData(queryClient, date, context.previousRecord ?? null);
          }
        }
        return;
      }
      if (!payload.result) return;
      const result = payload.result;
      if (result.state !== 'confirmed') {
        // A queued clinical-events edit is the base for this tab's next edit, but is not an ACK.
        // Publish only after local CAS accepted it, and never replace a newer visible record.
        const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        // Kept on this computer with its queue task: retrying, merged, queue-routed or held.
        const waitsInQueue =
          result.savedHere &&
          (result.state === 'held' || (result.state === 'local' && result.cause !== 'stored'));
        if (
          waitsInQueue &&
          isClinicalEventsOnlyDailyRecordPatch(payload.partial) &&
          context &&
          cachedRecord &&
          cachedRecord === context.previousRecord
        ) {
          context.unregisterPendingPatch();
          context.unregisterPendingPatch = registerPendingDailyRecordPatch(date, payload.partial);
          setDailyRecordQueryData(
            queryClient,
            date,
            applyOptimisticDailyRecordPatch(cachedRecord, payload.partial)
          );
        }
        return;
      }
      const confirmedRecord = payload.result.confirmedRecord;
      const displayRecord = payload.result.localProjectionRecord ?? confirmedRecord;
      const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(date)
      )?.record;
      const cacheAdvancedBeyondConfirmation = didDailyRecordCacheAdvanceBeyondConfirmation(
        cachedRecord,
        confirmedRecord,
        context?.optimisticRecord?.lastUpdated
      );
      const nextDisplayRecord =
        cacheAdvancedBeyondConfirmation && confirmedRecord && cachedRecord
          ? payload.result.localProjectionRecord
            ? rebaseLocalProjectionOntoNewerRecord(
                confirmedRecord,
                payload.result.localProjectionRecord,
                cachedRecord
              )
            : cachedRecord
          : displayRecord;
      if (nextDisplayRecord) {
        const published = await setAcknowledgedDailyRecordQueryData(
          queryClient,
          date,
          nextDisplayRecord,
          confirmedRecord,
          context?.optimisticRecord?.lastUpdated,
          { stillCurrent: () => isAuthorSessionCurrent(input) }
        );
        if (!published) return;
      }
      const currentRecord = confirmedRecord ?? cachedRecord ?? displayRecord;
      if (!currentRecord) return;
      markDailyRecordRemoteConfirmed(date, {
        source: 'write',
        remoteLastUpdated: currentRecord.lastUpdated,
        confirmedRecord: currentRecord,
      });
    },
    onSettled: (payload, error, input, context) => {
      context?.releaseMutationTurn();
      const partial = input.partial;
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
  // Keep server decisions paused offline; only local-first writes may enter the outbox now.
  const local = useMutation({ ...options, networkMode: 'always' });
  const remote = useMutation({ ...options, networkMode: 'online' });
  const { mutate: mutateLocal, mutateAsync: mutateLocalAsync, reset: resetLocal } = local;
  const { mutate: mutateRemote, mutateAsync: mutateRemoteAsync, reset: resetRemote } = remote;
  // Stable identities: the census actions built on these must not change each time a write moves
  // between pending and settled. The session is captured per call, never at creation.
  const mutate = useCallback(
    (input: DailyRecordPatchMutationVariables, options?: Parameters<typeof mutateLocal>[1]) => {
      const authored = capturePatchMutationInput(input);
      const viaRemote = requiresRemoteAuthority(authored);
      setRemoteSelected(viaRemote);
      return viaRemote ? mutateRemote(authored, options) : mutateLocal(authored, options);
    },
    [mutateLocal, mutateRemote]
  );
  const mutateAsync = useCallback(
    (
      input: DailyRecordPatchMutationVariables,
      options?: Parameters<typeof mutateLocalAsync>[1]
    ) => {
      const authored = capturePatchMutationInput(input);
      const viaRemote = requiresRemoteAuthority(authored);
      setRemoteSelected(viaRemote);
      return viaRemote ? mutateRemoteAsync(authored, options) : mutateLocalAsync(authored, options);
    },
    [mutateLocalAsync, mutateRemoteAsync]
  );
  const reset = useCallback(() => {
    resetLocal();
    resetRemote();
  }, [resetLocal, resetRemote]);
  return { ...(remoteSelected ? remote : local), mutate, mutateAsync, reset };
};
