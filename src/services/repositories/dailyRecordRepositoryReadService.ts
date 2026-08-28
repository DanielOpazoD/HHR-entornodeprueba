import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  getRecordForDate as getRecordFromIndexedDB,
  getPreviousDayRecord as getPreviousDayFromIndexedDB,
  getAllDates as getAllDatesFromIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { logLegacyInfo } from '@/services/storage/legacyfirebase/legacyFirebaseLogger';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { bridgeLegacyRecord } from '@/services/repositories/legacyRecordBridgeService';
import type {
  DailyRecordReadResult,
  LocalDailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import {
  createGetDailyRecordQuery,
  createGetPreviousDayQuery,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { mergeAvailableDates } from '@/services/repositories/dailyRecordSyncCompatibility';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { dailyRecordReadLogger } from '@/services/repositories/repositoryLoggers';
import {
  createLocalSyncHint,
  shouldHintLocalSync,
} from '@/services/observability/localSyncDiagnostics';
import {
  createBridgedDailyRecordReadResult,
  createLocalRuntimeReadCandidate,
  createLocalRuntimeReadResult,
  createNotFoundDailyRecordReadResult,
} from '@/services/repositories/dailyRecordReadResultController';
import {
  attemptRemoteGoldenPathRead,
  resolveRemoteGoldenPathReadResult,
} from '@/services/repositories/dailyRecordRemoteReadController';
import {
  getDailyRecordWriteStateForVersion,
  hasUnresolvedDailyRecordWriteForDate,
} from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import type { DailyRecordQueuedWriteState } from '@/services/storage/syncQueueTypes';

type FirestoreRecordQueriesModule =
  typeof import('@/services/storage/firestore/firestoreRecordQueries');
type DailyRecordRemoteLoaderModule =
  typeof import('@/services/repositories/dailyRecordRemoteLoader');

let firestoreRecordQueriesPromise: Promise<FirestoreRecordQueriesModule> | null = null;
let dailyRecordRemoteLoaderPromise: Promise<DailyRecordRemoteLoaderModule> | null = null;

const loadFirestoreRecordQueries = async (): Promise<FirestoreRecordQueriesModule> => {
  firestoreRecordQueriesPromise ??= import('@/services/storage/firestore/firestoreRecordQueries');
  return firestoreRecordQueriesPromise;
};

const loadDailyRecordRemoteLoader = async (): Promise<DailyRecordRemoteLoaderModule> => {
  dailyRecordRemoteLoaderPromise ??= import('@/services/repositories/dailyRecordRemoteLoader');
  return dailyRecordRemoteLoaderPromise;
};

const isRepositoryDebugEnabled = () =>
  import.meta.env.DEV &&
  String(import.meta.env.VITE_DEBUG_REPOSITORY || '').toLowerCase() === 'true';

const getE2EOverrideRecord = (date: string): DailyRecord | null => {
  if (typeof window === 'undefined' || !window.__HHR_E2E_OVERRIDE__) {
    return null;
  }

  return window.__HHR_E2E_OVERRIDE__[date] || null;
};

const getE2ELocalStorageRecord = (date: string): DailyRecord | null => {
  if (typeof window === 'undefined' || !window.__HHR_E2E_OVERRIDE__) {
    return null;
  }

  try {
    const records = JSON.parse(
      window.localStorage.getItem('hanga_roa_hospital_data') || '{}'
    ) as Record<string, DailyRecord> | null;
    return records?.[date] || null;
  } catch {
    return null;
  }
};

const logRemoteFetchAttempt = (date: string): void => {
  if (!isRepositoryDebugEnabled()) return;
  logLegacyInfo(`[Repository DEBUG] Attempting Firestore fetch for ${date}`);
  logLegacyInfo(`[Repository] Checking remote + legacy fallback for ${date}...`);
};

// Dev-only: the first time a remote read fails on localhost (usually an incomplete
// localhost sign-in), emit one actionable hint. Never fires in test or production.
const emitLocalSyncHintOnce = createLocalSyncHint({
  shouldHint: () =>
    shouldHintLocalSync(
      import.meta.env.MODE,
      typeof window !== 'undefined' ? window.location.hostname : undefined
    ),
  warn: message => dailyRecordReadLogger.warn(message),
});

export const getForDate = async (
  date: string,
  syncFromRemote: boolean = true
): Promise<DailyRecord | null> => {
  const result = await getForDateWithMeta(date, syncFromRemote);
  return result.record;
};

/**
 * Reads the server-authoritative census without combining it with pending IndexedDB state.
 * Structural Rayen planning must start here: the ordinary golden read intentionally preserves
 * concurrent local edits and can therefore show one episode in both its old and new bed.
 */
export const getAuthoritativeForDate = async (date: string): Promise<DailyRecord | null> => {
  const e2eOverride = getE2EOverrideRecord(date);
  if (e2eOverride) return e2eOverride;

  if (!isFirestoreEnabled()) {
    throw new Error(
      'La sincronización estructural con Eloísa requiere una versión autoritativa remota.'
    );
  }

  return measureRepositoryOperation(
    'dailyRecord.getAuthoritativeForDate',
    async () => {
      const { loadRemoteRecordWithFallback } = await loadDailyRecordRemoteLoader();
      return (await loadRemoteRecordWithFallback(date, { source: 'server' })).record;
    },
    { thresholdMs: 220, context: date }
  );
};

/**
 * Reads the exact local IndexedDB candidate without hydrating or combining it with Firestore.
 * Structural persistence uses it only to retain pending local fields while the remote record
 * remains authoritative for the episode-to-bed placement and CAS revision.
 */
export const getLocalForDate = async (date: string): Promise<DailyRecord | null> => {
  return getE2ELocalStorageRecord(date) || getRecordFromIndexedDB(date);
};

export const getLocalForDateWithMeta = async (
  date: string
): Promise<LocalDailyRecordReadResult> => {
  const record = await getLocalForDate(date);
  const [writeState, hasPendingWritesForDate] = await Promise.all([
    record
      ? getDailyRecordWriteStateForVersion(date, record.lastUpdated)
      : Promise.resolve<DailyRecordQueuedWriteState>('none'),
    hasUnresolvedDailyRecordWriteForDate(date),
  ]);
  return {
    record,
    hasPendingWrites: writeState === 'active',
    hasPendingWritesForDate,
    writeState,
  };
};

export const getForDateWithMeta = async (
  date: string,
  syncFromRemote: boolean = true
): Promise<DailyRecordReadResult> => {
  return measureRepositoryOperation(
    'dailyRecord.getForDate',
    async () => {
      const query = createGetDailyRecordQuery(date, syncFromRemote);
      const indexedDbLocalRecord = await getRecordFromIndexedDB(query.date);
      const e2eOverride = getE2EOverrideRecord(query.date);
      const localRecord = e2eOverride
        ? getE2ELocalStorageRecord(query.date) || indexedDbLocalRecord
        : indexedDbLocalRecord;
      const localCandidate = localRecord
        ? createLocalRuntimeReadCandidate(query.date, localRecord)
        : null;
      if (e2eOverride) {
        dailyRecordReadLogger.warn(`Using E2E override record for ${query.date}`);
        return resolveRemoteGoldenPathReadResult({
          date: query.date,
          localCandidate,
          remoteReadResult: {
            record: e2eOverride,
            source: 'firestore',
            compatibilityTier: 'current_firestore',
            compatibilityIntensity: 'none',
            migrationRulesApplied: [],
            cachedLocally: false,
          },
        });
      }

      if (query.syncFromRemote && isFirestoreEnabled()) {
        const { loadRemoteRecordWithFallback } = await loadDailyRecordRemoteLoader();
        return attemptRemoteGoldenPathRead({
          date: query.date,
          localCandidate,
          loadRemoteRecordWithFallback,
          logRemoteFetchAttempt,
          onRemoteFetchFailure: (err, failedDate) => {
            dailyRecordReadLogger.warn(`Remote fetch failed for ${failedDate}`, err);
            emitLocalSyncHintOnce();
          },
        });
      }

      if (localCandidate) {
        return createLocalRuntimeReadResult(query.date, localCandidate, 'indexeddb');
      }

      return createNotFoundDailyRecordReadResult(query.date, 'not_requested');
    },
    { thresholdMs: 120, context: date }
  );
};

export const bridgeLegacyRecordForDate = async (date: string): Promise<DailyRecordReadResult> => {
  const bridged = await bridgeLegacyRecord(date);
  return createBridgedDailyRecordReadResult(date, bridged);
};

export const getAvailableDates = async (): Promise<string[]> => {
  const localDates = await getAllDatesFromIndexedDB();

  if (isFirestoreEnabled()) {
    try {
      const { getAvailableDatesFromFirestore } = await loadFirestoreRecordQueries();
      const remoteDates = await getAvailableDatesFromFirestore();
      return mergeAvailableDates(localDates, remoteDates);
    } catch (err) {
      dailyRecordReadLogger.warn('Failed to fetch remote dates', err);
    }
  }

  return localDates.sort().reverse();
};

export const getMonthRecords = async (
  year: number,
  monthZeroBased: number
): Promise<DailyRecord[]> => {
  if (!isFirestoreEnabled()) {
    return [];
  }

  const { getMonthRecordsFromFirestore } = await loadFirestoreRecordQueries();
  return getMonthRecordsFromFirestore(year, monthZeroBased);
};

export const getPreviousDay = async (date: string): Promise<DailyRecord | null> => {
  const result = await getPreviousDayWithMeta(date);
  return result.record;
};

export const getPreviousDayWithMeta = async (date: string): Promise<DailyRecordReadResult> => {
  const query = createGetPreviousDayQuery(date);

  const localRecord = await getPreviousDayFromIndexedDB(query.date);
  if (localRecord) {
    return createLocalRuntimeReadResult(
      localRecord.date,
      createLocalRuntimeReadCandidate(localRecord.date, localRecord),
      'indexeddb'
    );
  }

  if (isFirestoreEnabled()) {
    try {
      const allDates = await getAvailableDates();
      const prevDate = allDates.find(d => d < query.date);

      if (prevDate) {
        return await getForDateWithMeta(prevDate);
      }
    } catch (err) {
      dailyRecordReadLogger.warn(`Remote previous-day lookup failed for ${query.date}`, err);
    }
  }

  return createNotFoundDailyRecordReadResult(query.date, 'missing');
};
