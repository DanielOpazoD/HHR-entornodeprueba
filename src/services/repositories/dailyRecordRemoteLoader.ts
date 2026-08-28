import { DailyRecord } from '@/types/domain/dailyRecord';
import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore/firestoreRecordQueries';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  LegacyMigrationRule,
  MigrationCompatibilityIntensity,
} from '@/services/repositories/dataMigrationContracts';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';

export type DailyRecordRemoteSource = 'firestore' | 'not_found';
export type DailyRecordRemoteCompatibilityTier = 'current_firestore' | 'none';

export interface DailyRecordRemoteLoadResult {
  record: DailyRecord | null;
  source: DailyRecordRemoteSource;
  compatibilityTier: DailyRecordRemoteCompatibilityTier;
  compatibilityIntensity: MigrationCompatibilityIntensity;
  migrationRulesApplied: LegacyMigrationRule[];
  cachedLocally: boolean;
}

const remoteLoadInFlight = new Map<string, Promise<DailyRecordRemoteLoadResult>>();

interface DailyRecordRemoteLoadOptions {
  /** Structural CAS planning must bypass the Firestore SDK cache. */
  source?: 'default' | 'server';
}

const normalizeRemoteRecord = (
  record: DailyRecord,
  date: string
): {
  record: DailyRecord;
  migrationRulesApplied: LegacyMigrationRule[];
  compatibilityIntensity: MigrationCompatibilityIntensity;
} => {
  const migrated = migrateLegacyDataWithReport(record, date);
  return {
    record: migrated.record,
    migrationRulesApplied: migrated.appliedRules,
    compatibilityIntensity: migrated.compatibilityIntensity,
  };
};

const createRemoteLoadResult = (
  source: DailyRecordRemoteSource,
  record: DailyRecord | null,
  migrationRulesApplied: LegacyMigrationRule[] = [],
  compatibilityIntensity: MigrationCompatibilityIntensity = 'none',
  cachedLocally: boolean = false
): DailyRecordRemoteLoadResult => ({
  record,
  source,
  compatibilityTier: source === 'firestore' ? 'current_firestore' : 'none',
  compatibilityIntensity,
  migrationRulesApplied,
  cachedLocally,
});

export const loadRemoteRecordWithFallback = async (
  date: string,
  options: DailyRecordRemoteLoadOptions = {}
): Promise<DailyRecordRemoteLoadResult> => {
  const source = options.source ?? 'default';
  const requestKey = `${source}:${date}`;
  const existingRequest = remoteLoadInFlight.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = measureRepositoryOperation(
    'dailyRecord.loadRemoteWithFallback',
    async () => {
      const remoteRead = await getRecordFromFirestoreDetailed(date, { source });
      if (remoteRead.status === 'failed') {
        throw remoteRead.error ?? new Error(`Remote Firestore read failed for ${date}`);
      }

      if (remoteRead.record) {
        const normalizedRemoteRecord = normalizeRemoteRecord(remoteRead.record, date);
        return createRemoteLoadResult(
          'firestore',
          normalizedRemoteRecord.record,
          normalizedRemoteRecord.migrationRulesApplied,
          normalizedRemoteRecord.compatibilityIntensity,
          false
        );
      }

      return createRemoteLoadResult('not_found', null);
    },
    { thresholdMs: 220, context: date }
  ).finally(() => {
    remoteLoadInFlight.delete(requestKey);
  });

  remoteLoadInFlight.set(requestKey, request);
  return request;
};
