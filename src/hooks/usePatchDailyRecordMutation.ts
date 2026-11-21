import {
  authoredOptions,
  isAuthoringSessionCurrent,
  type PublicWriteOptions,
} from '@/services/storage/authoringSession';
import { isClinicalEventsOnlyDailyRecordPatch } from '@/services/repositories/dailyRecordClinicalDomainService';
import { mutationOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { queryKeys } from '@/config/queryClient';
import { useRepositories } from '@/context/RepositoryContext';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import {
  isDailyRecordWriteRejectedResult,
  type DailyRecordWriteResult,
} from '@/services/repositories/contracts/dailyRecordResults';
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
  patchDailyRecordWithCompatibility,
  releasePendingPatchAfterFallbackTtl,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  createDailyRecordPatchBaseRecordRegistry,
  forgetDailyRecordPatchBaseRecord,
  getDailyRecordPatchBaseRecord,
  rememberDailyRecordPatchBaseRecord,
} from '@/hooks/controllers/dailyRecordPatchBaseRecordController';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import {
  canApplyClinicalCribCreate,
  rebaseClinicalCribCreate,
  rebaseClinicalCribCreatePatch,
} from '@/hooks/controllers/clinicalCribController';
import {
  buildAppliedBedClearPatch,
  canRebaseIntentionalBedClear,
  isIntentionalBedClearAlreadyApplied,
  rebaseIntentionalBedClear,
} from '@/hooks/controllers/intentionalBedClearController';
import {
  getDailyRecordPatchMutationKey,
  type DailyRecordPatchMutationVariables,
} from '@/hooks/controllers/dailyRecordPatchMutationController';
import {
  rebaseLocalProjectionOntoNewerRecord,
  shouldPublishAuthoritativeConflictRecord,
  shouldRollbackOptimisticDailyRecord,
} from '@/hooks/controllers/dailyRecordLocalProjectionController';

type PatchMutationInput = {
  date?: string;
  partial: DailyRecordPatch;
  options: PartialUpdateDailyRecordOptions;
};

const resolveInput = (
  input: DailyRecordPatchMutationVariables
): {
  date?: string;
  partial: DailyRecordPatch;
  options?: PublicWriteOptions<PartialUpdateDailyRecordOptions>;
} => {
  if (
    'partial' in input &&
    input.partial !== null &&
    typeof input.partial === 'object' &&
    !Array.isArray(input.partial)
  ) {
    return input as {
      date?: string;
      partial: DailyRecordPatch;
      options?: PublicWriteOptions<PartialUpdateDailyRecordOptions>;
    };
  }
  return { partial: input as DailyRecordPatch };
};

/**
 * Logout clears the census cache. An edit whose session has ended since it began must not write
 * into the cache of whoever comes next; its durable copy and queue task stay with its author.
 */
const isAuthorSessionCurrent = (input: PatchMutationInput) =>
  isAuthoringSessionCurrent(input.options.authoringSession);

const mutationTails = new Map<string, Promise<void>>();
const captureInput = (input: DailyRecordPatchMutationVariables): PatchMutationInput => {
  const resolved = resolveInput(input);
  return {
    ...resolved,
    options: authoredOptions<PartialUpdateDailyRecordOptions>(resolved.options ?? {}),
  };
};

/** Server decisions wait for the network; plain local-first edits may enter the outbox offline. */
const requiresRemoteAuthority = (input: PatchMutationInput): boolean => {
  const { options } = resolveInput(input);
  return Boolean(
    options?.requireRemoteAuthorityFirst ||
    options?.intentionalBedClear ||
    options?.clinicalCribCreate ||
    options?.specialtyIntent
  );
};

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

class AuthoritativeDailyRecordConflictError extends ConcurrencyError {
  constructor(
    message: string,
    readonly authoritativeRecord: DailyRecord
  ) {
    super(message);
    this.name = 'AuthoritativeDailyRecordConflictError';
  }
}

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
    mutationFn: async (input: PatchMutationInput) => {
      const { partial, options, date = currentDate } = input;
      let writePatch = partial;
      const baseRecord = getDailyRecordPatchBaseRecord(patchBaseRecords, partial);
      const buildOptions = (record: DailyRecord | undefined) => ({
        ...options,
        ...(record ? { baseRecord: record } : {}),
        ...(options?.intentionalBedClear && record
          ? {
              intentionalBedClear: rebaseIntentionalBedClear(options.intentionalBedClear, record),
            }
          : {}),
        ...(options?.clinicalCribCreate && record
          ? { clinicalCribCreate: rebaseClinicalCribCreate(options.clinicalCribCreate, record) }
          : {}),
      });
      const write = (record: DailyRecord | undefined) =>
        patchDailyRecordWithCompatibility(dailyRecord, date, writePatch, buildOptions(record));
      const adoptAlreadyAppliedClear = async (record: DailyRecord) => {
        const intent = options?.intentionalBedClear;
        const appliedPatch = buildAppliedBedClearPatch(intent, record, partial);
        const adoptedRecord = await dailyRecord.adoptAuthoritativeRecord(record, appliedPatch);
        const alreadyApplied: DailyRecordWriteResult = {
          date,
          savedHere: true,
          state: 'confirmed',
          localCopy: 'current',
          confirmedRecord: record,
          localProjectionRecord: adoptedRecord,
        };
        return alreadyApplied;
      };

      let writeBaseRecord = baseRecord;
      if (options?.intentionalBedClear) {
        // The visible census can legitimately lag one Firestore revision behind a background
        // update. Keep the row optimistic, but bind the destructive command to a fresh server
        // snapshot before its first write. The occupant/crib identity guard makes this a safe
        // rebase; it is not a blind retry.
        const authoritativeRecord = await dailyRecord.getAuthoritativeForDate(date);
        if (
          isIntentionalBedClearAlreadyApplied(
            options.intentionalBedClear,
            authoritativeRecord,
            partial
          )
        ) {
          return {
            partial,
            options,
            result: await adoptAlreadyAppliedClear(authoritativeRecord),
          };
        }
        if (!canRebaseIntentionalBedClear(options.intentionalBedClear, authoritativeRecord)) {
          if (authoritativeRecord) {
            throw new AuthoritativeDailyRecordConflictError(
              'La cama cambió desde que se confirmó la limpieza. Se cargó la versión del servidor; revísela antes de confirmar otra limpieza.',
              authoritativeRecord
            );
          }
          throw new ConcurrencyError(
            'La cama cambió desde que se confirmó la limpieza. Recargue antes de intentarlo nuevamente.'
          );
        }
        writeBaseRecord = authoritativeRecord;
        rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, authoritativeRecord);
      } else if (options?.clinicalCribCreate) {
        const authoritativeRecord = await dailyRecord.getAuthoritativeForDate(date);
        if (!authoritativeRecord) {
          throw new ConcurrencyError(
            'No fue posible confirmar la versión vigente del censo. Recargue antes de crear la cuna.'
          );
        }
        if (!canApplyClinicalCribCreate(options.clinicalCribCreate, authoritativeRecord)) {
          throw new AuthoritativeDailyRecordConflictError(
            'La cama o su cuna cambiaron antes de confirmar la creación. Se cargó la versión vigente del censo.',
            authoritativeRecord
          );
        }
        writePatch = rebaseClinicalCribCreatePatch(
          partial,
          options.clinicalCribCreate,
          authoritativeRecord
        );
        writeBaseRecord = authoritativeRecord;
        rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, authoritativeRecord);
      }

      let result;
      try {
        result = await write(writeBaseRecord);
      } catch (error) {
        if (!(error instanceof ConcurrencyError) || !options?.intentionalBedClear) {
          throw error;
        }

        const latestRecord = await dailyRecord.getAuthoritativeForDate(date);
        if (
          isIntentionalBedClearAlreadyApplied(options.intentionalBedClear, latestRecord, partial)
        ) {
          result = await adoptAlreadyAppliedClear(latestRecord);
        } else if (!canRebaseIntentionalBedClear(options.intentionalBedClear, latestRecord)) {
          throw new ConcurrencyError(
            'La cama cambió desde que se confirmó la limpieza. Recargue antes de intentarlo nuevamente.'
          );
        } else {
          rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, latestRecord);
          result = await write(latestRecord);
        }
      }
      return { partial, options, result };
    },
    onMutate: async input => {
      const { date = currentDate } = input;
      const releaseMutationTurn = await acquireMutationTurn(date);
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
      const authored = captureInput(input);
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
      const authored = captureInput(input);
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
