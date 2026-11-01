import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import {
  persistHydratedRecordToLocalCache,
  persistPointReadToLocalCache,
} from '@/services/repositories/dailyRecordLocalCachePersistence';
import {
  hasRemoteClinicalTextShrinkage,
  resolveDailyRecordPersistenceGoldenPath,
} from '@/services/repositories/dailyRecordPersistenceGoldenPath';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import {
  createGoldenPathReadResult,
  createSupersededReadResult,
  createRetainedPendingProjectionReadResult,
  type LocalRuntimeReadCandidate,
} from '@/services/repositories/dailyRecordReadResultController';
import { dailyRecordReadLogger } from '@/services/repositories/repositoryLoggers';
import type { DailyRecordRemoteLoadResult } from '@/services/repositories/dailyRecordRemoteLoader';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getPendingDailyRecordProjection } from '@/services/storage/sync/dailyRecordSyncQueueReadService';

import {
  inspectLocalRecordAdmission,
  type LocalRecordBase,
} from '@/services/storage/indexeddb/indexedDbRecordService';

interface ResolveRemoteGoldenPathReadResultInput {
  date: string;
  localCandidate: LocalRuntimeReadCandidate | null;
  remoteReadResult: DailyRecordRemoteLoadResult;
  base?: LocalRecordBase;
  persistHydratedRecord?: (
    record: DailyRecord,
    date: string,
    previousRecord?: DailyRecord | null
  ) => Promise<DailyRecord>;
}

interface AttemptRemoteGoldenPathReadInput {
  date: string;
  localCandidate: LocalRuntimeReadCandidate | null;
  base?: LocalRecordBase;
  loadRemoteRecordWithFallback: (
    date: string,
    options?: { base?: LocalRecordBase }
  ) => Promise<DailyRecordRemoteLoadResult>;
  onRemoteFetchFailure?: (error: unknown, date: string) => void;
}

export const resolveRemoteGoldenPathReadResult = async ({
  date,
  localCandidate,
  remoteReadResult,
  base = remoteReadResult.issuedAgainst,
  persistHydratedRecord = persistHydratedRecordToLocalCache,
}: ResolveRemoteGoldenPathReadResultInput): Promise<DailyRecordReadResult> => {
  const shouldProtectLocalClinicalText = hasRemoteClinicalTextShrinkage(
    localCandidate?.record || null,
    remoteReadResult.record
  );
  const effectiveRemoteReadResult =
    localCandidate?.record && remoteReadResult.record && !shouldProtectLocalClinicalText
      ? {
          ...remoteReadResult,
          record: resolveDailyRecordConflict(remoteReadResult.record, localCandidate.record),
        }
      : remoteReadResult;
  const goldenPath = resolveDailyRecordPersistenceGoldenPath({
    localRecord: localCandidate?.record || null,
    remoteRecord: effectiveRemoteReadResult.record,
    remoteHistorySource: remoteReadResult.record ?? undefined,
    remoteAvailability: effectiveRemoteReadResult.record
      ? 'resolved'
      : effectiveRemoteReadResult.serverConfirmed
        ? 'missing'
        : 'unavailable',
    localRepairApplied: localCandidate?.repairApplied || false,
    remoteRepairApplied:
      effectiveRemoteReadResult.compatibilityIntensity !== 'none' ||
      effectiveRemoteReadResult.migrationRulesApplied.length > 0,
  });

  const selectedLocalMerge =
    goldenPath.selectedStore === 'local' &&
    goldenPath.selectedRecord &&
    localCandidate?.record &&
    goldenPath.selectedRecord !== localCandidate.record
      ? goldenPath.selectedRecord
      : null;
  const recordToHydrate =
    selectedLocalMerge ||
    (goldenPath.shouldHydrateLocal && effectiveRemoteReadResult.record
      ? goldenPath.selectedRecord || effectiveRemoteReadResult.record
      : null);

  let pointReadAdmitted = false;
  if (recordToHydrate) {
    try {
      if (base) {
        const hydration = await persistPointReadToLocalCache(
          recordToHydrate,
          date,
          base,
          localCandidate?.record || null
        );
        if (hydration.status === 'superseded') {
          return createSupersededReadResult(
            date,
            hydration.stored,
            await getPendingDailyRecordProjection(date)
          );
        }
        pointReadAdmitted = true;
      } else {
        await persistHydratedRecord(recordToHydrate, date, localCandidate?.record || null);
      }
    } catch (error) {
      if (error instanceof AdmissionDatePolicyViolationError) {
        dailyRecordReadLogger.warn(
          `Skipped local hydration for ${date} due to admissionDate validation`,
          error
        );
      } else {
        throw error;
      }
    }
  }

  if (base && !pointReadAdmitted) {
    const admission = await inspectLocalRecordAdmission(date, base, goldenPath.selectedRecord);
    if (admission.status === 'superseded') {
      return createSupersededReadResult(
        date,
        admission.stored,
        await getPendingDailyRecordProjection(date)
      );
    }
  }
  const retainedRecord = await getPendingDailyRecordProjection(date);
  if (retainedRecord)
    return createRetainedPendingProjectionReadResult(
      date,
      retainedRecord,
      remoteReadResult.serverConfirmed
    );
  return createGoldenPathReadResult(date, goldenPath, localCandidate, effectiveRemoteReadResult);
};

export const attemptRemoteGoldenPathRead = async ({
  date,
  localCandidate,
  loadRemoteRecordWithFallback,
  base,
  onRemoteFetchFailure,
}: AttemptRemoteGoldenPathReadInput): Promise<DailyRecordReadResult> => {
  try {
    const remoteReadResult = await loadRemoteRecordWithFallback(date, { base });
    return resolveRemoteGoldenPathReadResult({
      date,
      localCandidate,
      remoteReadResult,
      base: remoteReadResult.issuedAgainst ?? base,
    });
  } catch (error) {
    onRemoteFetchFailure?.(error, date);

    const fallbackGoldenPath = resolveDailyRecordPersistenceGoldenPath({
      localRecord: localCandidate?.record || null,
      remoteRecord: null,
      remoteAvailability: 'unavailable',
      localRepairApplied: localCandidate?.repairApplied || false,
    });

    return createGoldenPathReadResult(date, fallbackGoldenPath, localCandidate);
  }
};
