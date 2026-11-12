import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  createDailyRecordReadResult,
  type DailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { resolveDailyRecordReadConsistency } from '@/services/repositories/dailyRecordConsistencyPolicy';
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
      | 'serverConfirmed'
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
    serverConfirmed: options.serverConfirmed ?? false,
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

export const createSupersededReadResult = (
  date: string,
  stored: DailyRecord | null,
  pending: DailyRecord | null
): DailyRecordReadResult => {
  const record = pending ?? stored;
  const result = record
    ? createLocalRuntimeReadResult(
        date,
        { ...createLocalRuntimeReadCandidate(date, record), record },
        'indexeddb'
      )
    : createNotFoundDailyRecordReadResult(date, 'not_requested');
  return { ...result, serverConfirmed: false, publication: 'superseded' };
};
