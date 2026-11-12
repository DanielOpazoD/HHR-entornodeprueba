import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  getRecordForDate as getRecordFromIndexedDB,
  captureLocalRecordBase,
  getPreviousDayRecord as getPreviousDayFromIndexedDB,
  getAllDates as getAllDatesFromIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type {
  DailyRecordReadResult,
  LocalDailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import {
  createGetDailyRecordQuery,
  createGetPreviousDayQuery,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { dailyRecordReadLogger } from '@/services/repositories/repositoryLoggers';
import {
  createLocalSyncHint,
  shouldHintLocalSync,
} from '@/services/observability/localSyncDiagnostics';
import {
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

const loadFirestoreRecordQueries = createCachedRuntimeLoader(
  () => import('@/services/storage/firestore/firestoreRecordQueries')
);
const loadDailyRecordRemoteLoader = createCachedRuntimeLoader(
  () => import('@/services/repositories/dailyRecordRemoteLoader')
);

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
      window.localStorage.getItem('hanga_roa_hospital_data') ?? '{}'
    ) as Record<string, DailyRecord> | null;
    return records?.[date] || null;
  } catch {
    throw new Error('No se pudo leer el dato e2e de hanga_roa_hospital_data');
  }
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
      const base = await captureLocalRecordBase(query.date);
      const indexedDbLocalRecord = base.kind === 'stored' ? base.record : null;
      const e2eOverride = getE2EOverrideRecord(query.date);
      const localRecord = e2eOverride
        ? getE2ELocalStorageRecord(query.date) || indexedDbLocalRecord
        : indexedDbLocalRecord;
      const localCandidate = localRecord
        ? { ...createLocalRuntimeReadCandidate(query.date, localRecord), record: localRecord }
        : null;
      if (e2eOverride) {
        dailyRecordReadLogger.warn(`Using E2E override record for ${query.date}`);
        return resolveRemoteGoldenPathReadResult({
          date: query.date,
          localCandidate,
          remoteReadResult: {
            record: e2eOverride,
            serverConfirmed: true,
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
          base,
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

type DateIndexFailure = 'local' | 'remote' | 'both';

/** How much of the census date index could be read. Only a complete index is a history. */
type DateIndexRead =
  | { status: 'complete'; dates: string[] }
  | { status: 'partial' | 'unavailable'; failed: DateIndexFailure; cause: unknown };

const DATE_INDEX_FAILURE_MESSAGE: Record<DateIndexFailure, string> = {
  local: 'No se pudo leer la lista de días guardados en este equipo. Intente nuevamente.',
  remote:
    'No se pudo leer la lista de días del censo desde el servidor. Intente nuevamente con conexión.',
  both: 'No se pudo leer la lista de días del censo. Intente nuevamente.',
};

/** The date index was not read completely: a partial list would be planned as the whole history. */
class DailyRecordDateIndexIncompleteError extends Error {
  readonly status: 'partial' | 'unavailable';
  readonly failed: DateIndexFailure;

  constructor(read: Extract<DateIndexRead, { failed: DateIndexFailure }>) {
    super(DATE_INDEX_FAILURE_MESSAGE[read.failed], { cause: read.cause });
    this.name = 'DailyRecordDateIndexIncompleteError';
    this.status = read.status;
    this.failed = read.failed;
  }
}

const sortNewestFirst = (dates: Iterable<string>): string[] => [...new Set(dates)].sort().reverse();

const readDateIndex = async (): Promise<DateIndexRead> => {
  const local = await getAllDatesFromIndexedDB().then(
    dates => ({ ok: true as const, dates }),
    (cause: unknown) => ({ ok: false as const, cause })
  );
  if (!isFirestoreEnabled()) {
    return local.ok
      ? { status: 'complete', dates: sortNewestFirst(local.dates) }
      : { status: 'unavailable', failed: 'local', cause: local.cause };
  }

  const remote = await loadFirestoreRecordQueries()
    .then(module => module.getAvailableDatesFromFirestore())
    .then(
      dates => ({ ok: true as const, dates }),
      (cause: unknown) => ({ ok: false as const, cause })
    );
  if (local.ok) {
    return remote.ok
      ? { status: 'complete', dates: sortNewestFirst([...local.dates, ...remote.dates]) }
      : { status: 'partial', failed: 'remote', cause: remote.cause };
  }
  return remote.ok
    ? { status: 'partial', failed: 'local', cause: local.cause }
    : { status: 'unavailable', failed: 'both', cause: local.cause };
};

// Concurrent callers share one in-flight read without caching a stale answer for later calls.
let availableDatesInFlight: Promise<string[]> | undefined;

const readCompleteDates = async (): Promise<string[]> => {
  const read = await readDateIndex();
  if (read.status !== 'complete') {
    dailyRecordReadLogger.warn(`Census date index ${read.status}`, read.cause);
    throw new DailyRecordDateIndexIncompleteError(read);
  }
  return read.dates;
};

/**
 * Whole history. Reserved for migrations and backfills that need every date. It rejects
 * unless both the local and (when enabled) the server index were read: a partial list
 * would be planned, analyzed or harmonized as if it were the whole history.
 */
export const getAvailableDates = async (): Promise<string[]> => {
  availableDatesInFlight ??= readCompleteDates().finally(() => {
    availableDatesInFlight = undefined;
  });
  return availableDatesInFlight;
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

/**
 * The closest earlier census day, or not found when none exists locally or on the server.
 * A failed local or remote lookup rejects: it does not prove that there is no earlier day.
 */
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
    const { getPreviousRecordDateFromFirestore } = await loadFirestoreRecordQueries();
    const prevDate = await getPreviousRecordDateFromFirestore(query.date);
    if (prevDate) {
      return getForDateWithMeta(prevDate);
    }
  }

  return createNotFoundDailyRecordReadResult(query.date, 'missing');
};
