import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type {
  PartialUpdateDailyRecordOptions,
  SaveDailyRecordOptions,
} from '@/services/repositories/contracts/dailyRecordCommands';
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
import { getSyncClientId } from '@/services/storage/sync/syncMutationIdentity';

/**
 * Una confirmación remota escrita por ESTE mismo cliente no es un cambio ajeno:
 * es el eco de la edición anterior del propio usuario. Bloquear (y descartar en
 * silencio) la siguiente edición de una ráfaga por ese eco era la causa de los
 * cambios de estado/especialidad "que no se graban". El CAS remoto sigue
 * protegiendo contra escritores concurrentes reales.
 */
const isOwnClientRemoteConfirmation = (record: DailyRecord | null | undefined): boolean => {
  const lastWriterClientId = (
    record as { meta?: { lastWriterClientId?: unknown } } | null | undefined
  )?.meta?.lastWriterClientId;
  return typeof lastWriterClientId === 'string' && lastWriterClientId === getSyncClientId();
};

type FreshnessReason = 'resume' | 'clinical_patch' | 'clinical_save';

interface FreshnessDependencies {
  dailyRecord: DailyRecordRepositoryPort;
  queryClient: QueryClient;
}

export interface SaveDailyRecordMutationInput {
  record: DailyRecord;
  expectedLastUpdated?: string;
  requireConfirmedRecord?: boolean;
  rayenStructuralWriteGuard?: boolean;
  dailyRecordWriteLease?: SaveDailyRecordOptions['dailyRecordWriteLease'];
}

export const saveDailyRecordWithCompatibility = async (
  dailyRecord: DailyRecordRepositoryPort,
  record: DailyRecord,
  expectedLastUpdated: string = record.lastUpdated,
  options?: SaveDailyRecordOptions
): Promise<SaveDailyRecordResult | null> => {
  if (typeof dailyRecord.saveDetailed === 'function') {
    return options
      ? dailyRecord.saveDetailed(record, expectedLastUpdated, options)
      : dailyRecord.saveDetailed(record, expectedLastUpdated);
  }

  await dailyRecord.save(record, expectedLastUpdated);
  return null;
};

export const persistDailyRecordSaveMutation = async (
  dailyRecord: DailyRecordRepositoryPort,
  input: SaveDailyRecordMutationInput
) => {
  const {
    record,
    expectedLastUpdated,
    requireConfirmedRecord,
    rayenStructuralWriteGuard,
    dailyRecordWriteLease,
  } = input;
  const options =
    requireConfirmedRecord || rayenStructuralWriteGuard || dailyRecordWriteLease
      ? { requireConfirmedRecord, rayenStructuralWriteGuard, dailyRecordWriteLease }
      : undefined;
  const result = await saveDailyRecordWithCompatibility(
    dailyRecord,
    record,
    expectedLastUpdated,
    options
  );
  return { record: result?.confirmedRecord ?? record, result };
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

  if (isOwnClientRemoteConfirmation(freshness.record)) {
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

export const ensureFreshDailyRecordSaveMutation = async (
  input: SaveDailyRecordMutationInput,
  dependencies: FreshnessDependencies
): Promise<void> => {
  if (input.rayenStructuralWriteGuard) return;
  const anchor = input.expectedLastUpdated
    ? { ...input.record, lastUpdated: input.expectedLastUpdated }
    : input.record;
  await ensureFreshClinicalSaveMutation(anchor, dependencies);
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
