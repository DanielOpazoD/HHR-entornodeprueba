import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { queryKeys } from '@/config/queryClient';
import { useRepositories } from '@/services/RepositoryContext';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import {
  createUpdatePartialDailyRecordResult,
  isDailyRecordWriteRejectedResult,
} from '@/services/repositories/contracts/dailyRecordResults';
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
  canApplyClinicalCribCreate,
  rebaseClinicalCribCreate,
  rebaseClinicalCribCreatePatch,
} from '@/hooks/controllers/clinicalCribController';
import {
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
        patchDailyRecordWithCompatibility(
          dailyRecord,
          date,
          writePatch,
          record || options ? buildOptions(record) : undefined
        );
      const adoptAlreadyAppliedClear = async (record: DailyRecord) => {
        const adoptedRecord = await dailyRecord.adoptAuthoritativeRecord(record, partial);
        return createUpdatePartialDailyRecordResult({
          date,
          outcome: 'clean',
          savedLocally: true,
          updatedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: Math.max(1, Object.keys(partial).length),
          confirmedRecord: record,
          localProjectionRecord: adoptedRecord,
          observabilityTags: ['daily_record', 'write', 'persisted_and_synced', 'already_applied'],
        });
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
      const releaseMutationTurn = await acquireMutationTurn(date);
      try {
        const { partial, options } = resolveInput(input);
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
        rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, freshRecord);

        await queryClient.cancelQueries({ queryKey: queryKeys.dailyRecord.byDate(date) });
        const isRemoteAuthorityFirst = options?.requireRemoteAuthorityFirst === true;
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
          setDailyRecordQueryData(queryClient, date, error.authoritativeRecord);
        }
      } else if (context?.optimisticApplied && context.previousRecord) {
        const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
          getDailyRecordQueryKey(date)
        )?.record;
        if (shouldRollbackOptimisticDailyRecord(cachedRecord, context.optimisticRecord)) {
          setDailyRecordQueryData(queryClient, date, context.previousRecord);
        }
      }
      forgetDailyRecordPatchBaseRecord(patchBaseRecords, resolveInput(input).partial);
    },
    onSuccess: (payload, _input, context) => {
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
      if (!payload.result?.updatedRemotely) return;
      const confirmedRecord = payload.result.confirmedRecord;
      const displayRecord = payload.result.localProjectionRecord ?? confirmedRecord;
      const cachedRecord = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(date)
      )?.record;
      const cacheIsOwnOptimisticProjection = Boolean(
        cachedRecord &&
        context?.optimisticRecord &&
        cachedRecord.lastUpdated === context.optimisticRecord.lastUpdated
      );
      // Only the server-confirmed revision participates in ordering. A client-generated projection
      // may have a future wall-clock timestamp, but it must be rebased onto any newer realtime
      // server record instead of hiding that record.
      const cacheAdvancedBeyondConfirmation = Boolean(
        confirmedRecord &&
        cachedRecord &&
        !cacheIsOwnOptimisticProjection &&
        isNewerThan(cachedRecord, confirmedRecord)
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
      if (nextDisplayRecord) setDailyRecordQueryData(queryClient, date, nextDisplayRecord);
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
