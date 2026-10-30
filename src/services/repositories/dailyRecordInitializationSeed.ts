import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  DailyRecordRemoteCompatibilityTier,
  DailyRecordRemoteLoadResult,
} from '@/services/repositories/dailyRecordRemoteLoader';
import { MigrationCompatibilityIntensity } from '@/services/repositories/dataMigrationContracts';

export type DailyRecordInitializationSeedSource =
  | 'copy_source'
  | 'remote_firestore'
  | 'remote_legacy'
  | 'local_current'
  | 'fresh';

export interface DailyRecordInitializationSeed {
  record: DailyRecord | null;
  source: DailyRecordInitializationSeedSource;
  compatibilityTier: DailyRecordRemoteCompatibilityTier | 'local_runtime';
  compatibilityIntensity: MigrationCompatibilityIntensity;
}

export const createRemoteInitializationSeed = (
  remoteResult: DailyRecordRemoteLoadResult
): DailyRecordInitializationSeed => ({
  record: remoteResult.record,
  source: 'remote_firestore',
  compatibilityTier: remoteResult.compatibilityTier,
  compatibilityIntensity: remoteResult.compatibilityIntensity,
});

export const createCopySourceInitializationSeed = (
  record: DailyRecord
): DailyRecordInitializationSeed => ({
  record,
  source: 'copy_source',
  compatibilityTier: 'local_runtime',
  compatibilityIntensity: 'none',
});

export const createFreshInitializationSeed = (): DailyRecordInitializationSeed => ({
  record: null,
  source: 'fresh',
  compatibilityTier: 'none',
  compatibilityIntensity: 'none',
});

export const shouldReturnSeedRecord = (
  seed: DailyRecordInitializationSeed
): seed is DailyRecordInitializationSeed & { record: DailyRecord } =>
  Boolean(seed.record && seed.source !== 'copy_source');
