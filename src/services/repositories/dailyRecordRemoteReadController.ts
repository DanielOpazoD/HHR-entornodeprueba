import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import { persistHydratedRecordToLocalCache } from '@/services/repositories/dailyRecordLocalCachePersistence';
import {
  hasRemoteClinicalTextShrinkage,
  resolveDailyRecordPersistenceGoldenPath,
} from '@/services/repositories/dailyRecordPersistenceGoldenPath';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import {
  createGoldenPathReadResult,
  type LocalRuntimeReadCandidate,
} from '@/services/repositories/dailyRecordReadResultController';
import { dailyRecordReadLogger } from '@/services/repositories/repositoryLoggers';
import type { DailyRecordRemoteLoadResult } from '@/services/repositories/dailyRecordRemoteLoader';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';

interface ResolveRemoteGoldenPathReadResultInput {
  date: string;
  localCandidate: LocalRuntimeReadCandidate | null;
  remoteReadResult: DailyRecordRemoteLoadResult;
  persistHydratedRecord?: (
    record: DailyRecord,
    date: string,
    previousRecord?: DailyRecord | null
  ) => Promise<DailyRecord>;
}

interface AttemptRemoteGoldenPathReadInput {
  date: string;
  localCandidate: LocalRuntimeReadCandidate | null;
  loadRemoteRecordWithFallback: (date: string) => Promise<DailyRecordRemoteLoadResult>;
  logRemoteFetchAttempt?: (date: string) => void;
  onRemoteFetchFailure?: (error: unknown, date: string) => void;
}

export const resolveRemoteGoldenPathReadResult = async ({
  date,
  localCandidate,
  remoteReadResult,
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
    remoteAvailability: effectiveRemoteReadResult.record ? 'resolved' : 'missing',
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

  if (recordToHydrate) {
    try {
      await persistHydratedRecord(recordToHydrate, date, localCandidate?.record || null);
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

  return createGoldenPathReadResult(date, goldenPath, localCandidate, effectiveRemoteReadResult);
};

export const attemptRemoteGoldenPathRead = async ({
  date,
  localCandidate,
  loadRemoteRecordWithFallback,
  logRemoteFetchAttempt,
  onRemoteFetchFailure,
}: AttemptRemoteGoldenPathReadInput): Promise<DailyRecordReadResult> => {
  try {
    logRemoteFetchAttempt?.(date);
    const remoteReadResult = await loadRemoteRecordWithFallback(date);
    return resolveRemoteGoldenPathReadResult({
      date,
      localCandidate,
      remoteReadResult,
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
