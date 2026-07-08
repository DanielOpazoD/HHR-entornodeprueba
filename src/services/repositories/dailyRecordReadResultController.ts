import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  createDailyRecordReadResult,
  type DailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { resolveDailyRecordReadConsistency } from '@/services/repositories/dailyRecordConsistencyPolicy';
import { resolveDailyRecordPersistenceGoldenPath } from '@/services/repositories/dailyRecordPersistenceGoldenPath';
import type { DailyRecordRemoteLoadResult } from '@/services/repositories/dailyRecordRemoteLoader';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export interface LocalRuntimeReadCandidate {
  record: DailyRecord;
  compatibilityIntensity: DailyRecordReadResult['compatibilityIntensity'];
  migrationRulesApplied: DailyRecordReadResult['migrationRulesApplied'];
  repairApplied: boolean;
}

export const createLocalRuntimeReadCandidate = (
  date: string,
  record: DailyRecord
): LocalRuntimeReadCandidate => {
  const migrated = migrateLegacyDataWithReport(record, date);
  return {
    record: migrated.record,
    compatibilityIntensity: migrated.compatibilityIntensity,
    migrationRulesApplied: migrated.appliedRules,
    repairApplied: migrated.compatibilityIntensity !== 'none' || migrated.appliedRules.length > 0,
  };
};

export const createLocalRuntimeReadResult = (
  date: string,
  candidate: LocalRuntimeReadCandidate,
  source: 'e2e' | 'indexeddb',
  options: Partial<
    Pick<
      DailyRecordReadResult,
      | 'consistencyState'
      | 'sourceOfTruth'
      | 'retryability'
      | 'recoveryAction'
      | 'conflictSummary'
      | 'observabilityTags'
      | 'userSafeMessage'
      | 'repairApplied'
    >
  > = {}
): DailyRecordReadResult => {
  const consistency = resolveDailyRecordReadConsistency({
    localRecord: candidate.record,
    remoteRecord: null,
    selectedRecord: candidate.record,
    remoteAvailability: 'not_requested',
    repairApplied: candidate.repairApplied,
  });
  return createDailyRecordReadResult(date, candidate.record, source, {
    compatibilityTier: 'local_runtime',
    compatibilityIntensity: candidate.compatibilityIntensity,
    migrationRulesApplied: candidate.migrationRulesApplied,
    consistencyState: options.consistencyState || consistency.consistencyState,
    sourceOfTruth: options.sourceOfTruth || consistency.sourceOfTruth,
    retryability: options.retryability || consistency.retryability,
    recoveryAction: options.recoveryAction || consistency.recoveryAction,
    conflictSummary: options.conflictSummary || consistency.conflictSummary,
    observabilityTags: options.observabilityTags || consistency.observabilityTags,
    userSafeMessage: options.userSafeMessage,
    repairApplied: options.repairApplied ?? consistency.repairApplied,
  });
};

export const createGoldenPathReadResult = (
  date: string,
  goldenPath: ReturnType<typeof resolveDailyRecordPersistenceGoldenPath>,
  localCandidate: LocalRuntimeReadCandidate | null,
  remoteReadResult?: DailyRecordRemoteLoadResult
): DailyRecordReadResult => {
  if (goldenPath.selectedStore === 'remote' && remoteReadResult?.record) {
    return createDailyRecordReadResult(
      date,
      goldenPath.selectedRecord || remoteReadResult.record,
      remoteReadResult.source,
      {
        compatibilityTier: remoteReadResult.compatibilityTier,
        compatibilityIntensity: remoteReadResult.compatibilityIntensity,
        migrationRulesApplied: remoteReadResult.migrationRulesApplied,
        consistencyState: goldenPath.consistencyState,
        sourceOfTruth: goldenPath.sourceOfTruth,
        retryability: goldenPath.retryability,
        recoveryAction: goldenPath.recoveryAction,
        conflictSummary: goldenPath.conflictSummary,
        observabilityTags: goldenPath.observabilityTags,
        userSafeMessage: goldenPath.userSafeMessage,
        repairApplied: goldenPath.repairApplied,
      }
    );
  }

  if (goldenPath.selectedStore === 'local' && localCandidate) {
    return createDailyRecordReadResult(
      date,
      goldenPath.selectedRecord || localCandidate.record,
      'indexeddb',
      {
        compatibilityTier: 'local_runtime',
        compatibilityIntensity: localCandidate.compatibilityIntensity,
        migrationRulesApplied: localCandidate.migrationRulesApplied,
        consistencyState: goldenPath.consistencyState,
        sourceOfTruth: goldenPath.sourceOfTruth,
        retryability: goldenPath.retryability,
        recoveryAction: goldenPath.recoveryAction,
        conflictSummary: goldenPath.conflictSummary,
        observabilityTags: goldenPath.observabilityTags,
        userSafeMessage: goldenPath.userSafeMessage,
        repairApplied: goldenPath.repairApplied,
      }
    );
  }

  return createDailyRecordReadResult(date, null, 'not_found', {
    consistencyState: goldenPath.consistencyState,
    sourceOfTruth: goldenPath.sourceOfTruth,
    retryability: goldenPath.retryability,
    recoveryAction: goldenPath.recoveryAction,
    conflictSummary: goldenPath.conflictSummary,
    observabilityTags: goldenPath.observabilityTags,
    userSafeMessage: goldenPath.userSafeMessage,
    repairApplied: goldenPath.repairApplied,
  });
};

export const createNotFoundDailyRecordReadResult = (
  date: string,
  remoteAvailability: 'missing' | 'not_requested'
): DailyRecordReadResult =>
  createDailyRecordReadResult(date, null, 'not_found', {
    ...resolveDailyRecordReadConsistency({
      localRecord: null,
      remoteRecord: null,
      selectedRecord: null,
      remoteAvailability,
    }),
  });

export const createBridgedDailyRecordReadResult = (
  date: string,
  bridged: {
    record: DailyRecord | null;
    source: DailyRecordReadResult['source'];
    compatibilityTier: DailyRecordReadResult['compatibilityTier'];
    compatibilityIntensity: DailyRecordReadResult['compatibilityIntensity'];
    migrationRulesApplied: DailyRecordReadResult['migrationRulesApplied'];
  }
): DailyRecordReadResult => {
  if (!bridged.record) {
    return createNotFoundDailyRecordReadResult(date, 'missing');
  }

  const consistency = resolveDailyRecordReadConsistency({
    localRecord: bridged.record,
    remoteRecord: null,
    selectedRecord: bridged.record,
    remoteAvailability: 'not_requested',
    repairApplied:
      bridged.compatibilityIntensity !== 'none' || bridged.migrationRulesApplied.length > 0,
  });
  return createDailyRecordReadResult(date, bridged.record, bridged.source, {
    compatibilityTier: bridged.compatibilityTier,
    compatibilityIntensity: bridged.compatibilityIntensity,
    migrationRulesApplied: bridged.migrationRulesApplied,
    consistencyState: consistency.consistencyState,
    sourceOfTruth: consistency.sourceOfTruth,
    retryability: consistency.retryability,
    recoveryAction: consistency.recoveryAction,
    conflictSummary: consistency.conflictSummary,
    observabilityTags: consistency.observabilityTags,
    userSafeMessage: consistency.userSafeMessage,
    repairApplied: consistency.repairApplied,
  });
};
