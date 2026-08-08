import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import {
  createDailyRecordQueryFn,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  DailyRecordFreshnessGateError,
  ensureDailyRecordRemoteFreshness,
  getDailyRecordClinicalFieldLocksByBedId,
  getDailyRecordLastRemoteConfirmedAt,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { didDailyRecordFreshnessHydrateNewerRemote } from '@/hooks/controllers/dailyRecordFreshnessHydrationController';
import { PENDING_DAILY_RECORD_PATCH_TTL_MS } from '@/hooks/controllers/dailyRecordPendingPatchController';
import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import {
  classifyHydratedRemotePatchRisk,
  isHydratedRemotePatchRiskBlocking,
} from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';
import { resolveDailyRecordClinicalPatchLockDecision } from '@/hooks/controllers/dailyRecordClinicalFieldAcknowledgementController';

type FreshnessReason = 'resume' | 'clinical_patch' | 'clinical_save';

interface FreshnessDependencies {
  dailyRecord: DailyRecordRepositoryPort;
  queryClient: QueryClient;
}

export const saveDailyRecordWithCompatibility = async (
  dailyRecord: DailyRecordRepositoryPort,
  record: DailyRecord,
  expectedLastUpdated: string = record.lastUpdated
): Promise<SaveDailyRecordResult | null> => {
  if (typeof dailyRecord.saveDetailed === 'function') {
    return dailyRecord.saveDetailed(record, expectedLastUpdated);
  }

  await dailyRecord.save(record, expectedLastUpdated);
  return null;
};

export const patchDailyRecordWithCompatibility = async (
  dailyRecord: DailyRecordRepositoryPort,
  date: string,
  partial: DailyRecordPatch,
  options?: PartialUpdateDailyRecordOptions
): Promise<UpdatePartialDailyRecordResult | null> => {
  if (typeof dailyRecord.updatePartialDetailed === 'function') {
    return options
      ? dailyRecord.updatePartialDetailed(date, partial, options)
      : dailyRecord.updatePartialDetailed(date, partial);
  }

  if (options) {
    await dailyRecord.updatePartial(date, partial, options);
  } else {
    await dailyRecord.updatePartial(date, partial);
  }
  return null;
};

export const releasePendingPatchAfterFallbackTtl = (release: () => void): void => {
  const timer = globalThis.setTimeout(release, PENDING_DAILY_RECORD_PATCH_TTL_MS);
  (timer as { unref?: () => void }).unref?.();
};

export const ensureFreshDailyRecordQuery = (
  date: string,
  { dailyRecord, queryClient }: FreshnessDependencies,
  reason: FreshnessReason
) =>
  ensureDailyRecordRemoteFreshness({
    date,
    queryClient,
    queryFn: createDailyRecordQueryFn(dailyRecord, date, true),
    reason,
  });

const assertClinicalMutationDidNotStartFromStaleRemoteHydration = (
  freshness: DailyRecordQueryResult
): void => {
  if (!didDailyRecordFreshnessHydrateNewerRemote(freshness)) {
    return;
  }

  throw new DailyRecordFreshnessGateError(
    'El censo se actualizó hace un momento. Intente nuevamente para continuar.'
  );
};

export const ensureFreshClinicalPatchMutation = (
  date: string,
  dependencies: FreshnessDependencies
): Promise<DailyRecordQueryResult> =>
  ensureFreshDailyRecordQuery(date, dependencies, 'clinical_patch');

export const assertHydratedRemotePatchCanProceed = ({
  date,
  attemptedPatch,
  previousRecord,
  freshness,
  remoteConfirmedAtBeforeMutation,
}: {
  date: string;
  attemptedPatch: DailyRecordPatch;
  previousRecord: DailyRecord | null | undefined;
  freshness: DailyRecordQueryResult;
  remoteConfirmedAtBeforeMutation?: number;
}): void => {
  const lockDecision = resolveDailyRecordClinicalPatchLockDecision(
    date,
    attemptedPatch,
    getDailyRecordClinicalFieldLocksByBedId(date),
    Date.now(),
    { previousRecord }
  );
  if (lockDecision.kind === 'soft_pause') {
    throw new DailyRecordFreshnessGateError(lockDecision.message, { presentation: 'silent' });
  }
  if (lockDecision.kind === 'hard_lock') {
    throw new DailyRecordFreshnessGateError(lockDecision.message);
  }

  const didHydrateNewerRemote = didDailyRecordFreshnessHydrateNewerRemote(freshness);
  if (!didHydrateNewerRemote) {
    return;
  }

  const remoteConfirmedAtAfterFreshness = getDailyRecordLastRemoteConfirmedAt(date);
  const mutationStartedBeforeNewConfirmation =
    typeof remoteConfirmedAtAfterFreshness === 'number' &&
    remoteConfirmedAtAfterFreshness !== remoteConfirmedAtBeforeMutation;
  if (mutationStartedBeforeNewConfirmation) {
    const risk = classifyHydratedRemotePatchRisk({
      attemptedPatch,
      previousRecord,
      hydratedRecord: freshness.record,
    });
    if (!isHydratedRemotePatchRiskBlocking(risk)) {
      return;
    }

    throw new DailyRecordFreshnessGateError(
      'El censo se actualizó hace un momento. Intente nuevamente para continuar.',
      { presentation: 'silent' }
    );
  }

  return;
};

export const ensureFreshClinicalSaveMutation = async (
  record: DailyRecord,
  dependencies: FreshnessDependencies
): Promise<DailyRecordQueryResult> => {
  const freshness = await ensureFreshDailyRecordQuery(record.date, dependencies, 'clinical_save');
  assertClinicalMutationDidNotStartFromStaleRemoteHydration(freshness);
  if (
    freshness.record &&
    toRecordTimestamp(freshness.record.lastUpdated) > toRecordTimestamp(record.lastUpdated)
  ) {
    throw new DailyRecordFreshnessGateError(
      'El censo se actualizó hace un momento. Intente nuevamente para continuar.'
    );
  }
  return freshness;
};

export const prefetchDailyRecordQuery = (
  queryClient: QueryClient,
  dailyRecord: DailyRecordRepositoryPort,
  date: string
) =>
  queryClient.prefetchQuery({
    queryKey: getDailyRecordQueryKey(date),
    queryFn: createDailyRecordQueryFn(dailyRecord, date),
  });
