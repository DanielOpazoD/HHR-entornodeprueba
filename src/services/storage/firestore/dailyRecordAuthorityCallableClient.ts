import { httpsCallable } from 'firebase/functions';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { DailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

const NON_RETRYABLE_AUTHORITY_CODES = new Set([
  'aborted',
  'already-exists',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'permission-denied',
  'unauthenticated',
]);

const authorityErrorCode = (error: unknown): string =>
  String((error as { code?: unknown })?.code ?? '')
    .toLowerCase()
    .replace(/^functions\//, '');

const authorityErrorMessage = (error: unknown): string =>
  String((error as { message?: unknown })?.message ?? '');

export const normalizeDailyRecordAuthorityError = (error: unknown): unknown => {
  const code = authorityErrorCode(error);
  const message = authorityErrorMessage(error);
  if (
    code === 'aborted' ||
    /revision_mismatch|version_mismatch|base revision|remote revision/i.test(message)
  ) {
    return new ConcurrencyError(
      'HHR detectó una versión más reciente de este censo y evitó sobrescribirla.'
    );
  }
  return error;
};

export const shouldRetryDailyRecordAuthorityError = (error: unknown): boolean => {
  if (error instanceof ConcurrencyError) return false;
  return !NON_RETRYABLE_AUTHORITY_CODES.has(authorityErrorCode(error));
};

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
  recordState?: {
    lastUpdated: string;
    meta: Record<string, unknown>;
    record: DailyRecord;
  };
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
  rayenClinicalWriteGuard?: RayenClinicalWriteGuard;
  historyPolicy?: 'snapshot' | 'skip';
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

  try {
    const result = await callable(payload);
    return result.data;
  } catch (error) {
    throw normalizeDailyRecordAuthorityError(error);
  }
};

export const patchDailyRecordWithClinicalAuthorityCallable = async (
  payload: DailyRecordAuthorityPatchCallablePayload
): Promise<DailyRecordAuthorityCallableResponse> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    DailyRecordAuthorityPatchCallablePayload,
    DailyRecordAuthorityCallableResponse
  >(functions, 'patchDailyRecordWithClinicalAuthority');

  try {
    const result = await callable(payload);
    return result.data;
  } catch (error) {
    throw normalizeDailyRecordAuthorityError(error);
  }
};
