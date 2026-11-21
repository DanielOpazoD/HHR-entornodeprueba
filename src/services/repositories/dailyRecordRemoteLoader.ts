import {
  captureLocalRecordBase,
  type LocalRecordBase,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { DailyRecord } from '@/types/domain/dailyRecord';
import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore/firestoreRecordQueries';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  LegacyMigrationRule,
  MigrationCompatibilityIntensity,
} from '@/services/repositories/dataMigrationContracts';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { confirmDailyRecordMissingOnServer } from '@/services/repositories/dailyRecordServerAbsence';

export type DailyRecordRemoteSource = 'firestore' | 'not_found';
export type DailyRecordRemoteCompatibilityTier = 'current_firestore' | 'none';

export interface DailyRecordRemoteLoadResult {
  serverConfirmed: boolean;
  issuedAgainst?: LocalRecordBase;
  record: DailyRecord | null;
  source: DailyRecordRemoteSource;
  compatibilityTier: DailyRecordRemoteCompatibilityTier;
  compatibilityIntensity: MigrationCompatibilityIntensity;
  migrationRulesApplied: LegacyMigrationRule[];
  cachedLocally: boolean;
  hasPendingWrites?: boolean;
}

/**
 * One observation of the day from Firestore, described the same way for the point read and the
 * listener: a confirmed absence is recorded, and a document is migrated before admission.
 */
export const describeRemoteDailyRecord = async (
  date: string,
  record: DailyRecord | null,
  observation: Pick<
    DailyRecordRemoteLoadResult,
    'serverConfirmed' | 'issuedAgainst' | 'hasPendingWrites'
  >
): Promise<DailyRecordRemoteLoadResult> => {
  if (!record && observation.serverConfirmed) await confirmDailyRecordMissingOnServer(date);
  const migrated = record ? migrateLegacyDataWithReport(record, date) : null;
  return {
    ...observation,
    record: migrated?.record ?? null,
    source: record ? 'firestore' : 'not_found',
    compatibilityTier: record ? 'current_firestore' : 'none',
    compatibilityIntensity: migrated?.compatibilityIntensity ?? 'none',
    migrationRulesApplied: migrated?.appliedRules ?? [],
    cachedLocally: false,
  };
};

const remoteLoadInFlight = new Map<string, Promise<DailyRecordRemoteLoadResult>>();

interface DailyRecordRemoteLoadOptions {
  /** Structural CAS planning must bypass the Firestore SDK cache. */
  source?: 'default' | 'server';
  base?: LocalRecordBase;
}

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
      const issuedAgainst =
        source === 'default' ? (options.base ?? (await captureLocalRecordBase(date))) : undefined;
      const remoteRead = await getRecordFromFirestoreDetailed(date, { source });
      if (remoteRead.status === 'failed') {
        throw remoteRead.error ?? new Error(`Remote Firestore read failed for ${date}`);
      }
      return describeRemoteDailyRecord(date, remoteRead.record, {
        issuedAgainst,
        hasPendingWrites: remoteRead.hasPendingWrites,
        serverConfirmed: remoteRead.serverConfirmed,
      });
    },
    { thresholdMs: 220, context: date }
  ).finally(() => {
    remoteLoadInFlight.delete(requestKey);
  });

  remoteLoadInFlight.set(requestKey, request);
  return request;
};
