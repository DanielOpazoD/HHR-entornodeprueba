import { httpsCallable } from 'firebase/functions';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { DailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';

export interface DailyRecordAuthorityCallablePayload {
  date: string;
  record: DailyRecord;
  expectedLastUpdated?: string;
  mode: Exclude<DailyRecordAuthorityMode, 'client_only'>;
  origin?: string;
  syncContract?: SyncTaskContract;
  dryRun?: boolean;
}

export interface DailyRecordAuthorityCallableResponse {
  success: boolean;
  date: string;
  mode: Exclude<DailyRecordAuthorityMode, 'client_only'>;
  authorityStatus: 'ok' | 'blocked';
  revision?: number;
  mutationId?: string;
  coverage?: {
    activePatients: number;
    canonicalEpisodeIds: number;
    fallbackEpisodeKeys: number;
    degenerateFallbackEpisodeKeys: number;
  };
  violations: Array<{
    type: string;
    path: string;
    bedId?: string;
    episodeKey?: string;
    message?: string;
  }>;
}

export interface DailyRecordAuthorityPatchCallablePayload {
  date: string;
  patch: Record<string, unknown>;
  expectedLastUpdated?: string;
  mode: Exclude<DailyRecordAuthorityMode, 'client_only'>;
  origin?: string;
  syncContract?: SyncTaskContract;
  dryRun?: boolean;
}

export const saveDailyRecordWithClinicalAuthorityCallable = async (
  payload: DailyRecordAuthorityCallablePayload
): Promise<DailyRecordAuthorityCallableResponse> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    DailyRecordAuthorityCallablePayload,
    DailyRecordAuthorityCallableResponse
  >(functions, 'saveDailyRecordWithClinicalAuthority');

  const result = await callable(payload);
  return result.data;
};

export const patchDailyRecordWithClinicalAuthorityCallable = async (
  payload: DailyRecordAuthorityPatchCallablePayload
): Promise<DailyRecordAuthorityCallableResponse> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    DailyRecordAuthorityPatchCallablePayload,
    DailyRecordAuthorityCallableResponse
  >(functions, 'patchDailyRecordWithClinicalAuthority');

  const result = await callable(payload);
  return result.data;
};
