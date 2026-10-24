import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  findStaleClinicalDerivedEpisodeIds,
  isClinicalDerivedDocId,
  overlayClinicalDerived,
  readClinicalDerivedLayout,
} from '@/services/storage/clinicalDerivedContract';
import type {
  ClinicalDerivedReadFailure,
  ClinicalDerivedReadSource,
} from '@/services/storage/firestore/clinicalDerivedEpisodeReader';

/**
 * Combined read view of a split day (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md, D10).
 * The result is for reading and rebuilding only: it must never reach a write's base record,
 * IndexedDB, the sync queue, the TanStack cache or a conflict copy.
 *
 * - `strict` (inputs of a clinical write): reads from the server, checks that no current document
 *   is ahead of the day, and throws `ClinicalDerivedReadError` instead of returning embedded data.
 * - `bestEffort` (display and export): falls back to the embedded record and says why.
 *
 * Readers that need the documents themselves, not an overlay, use `readClinicalDerivedDayDocs`
 * (every document of a day) and `readClinicalDerivedEpisodeForDisplay` (one episode).
 */

type ClinicalDerivedEpisodeReaderModule =
  typeof import('@/services/storage/firestore/clinicalDerivedEpisodeReader');

let readerPromise: Promise<ClinicalDerivedEpisodeReaderModule> | null = null;

// A chunk that failed to load (offline on first use, a stale hash after a deploy) is not cached:
// the next call tries again.
const loadReader = (): Promise<ClinicalDerivedEpisodeReaderModule> => {
  readerPromise ??= import('@/services/storage/firestore/clinicalDerivedEpisodeReader').catch(
    (error: unknown) => {
      readerPromise = null;
      throw error;
    }
  );
  return readerPromise;
};

export type ClinicalDerivedReadMode = 'strict' | 'bestEffort';

export type ClinicalDerivedFallbackReason =
  | 'permission_denied'
  | 'read_failed'
  | 'stale_day'
  | 'duplicate_episode'
  | 'unsupported_layout'
  | 'cache_only';

export class ClinicalDerivedReadError extends Error {
  constructor(
    readonly date: string,
    readonly reason: ClinicalDerivedFallbackReason,
    readonly code?: string
  ) {
    super(`clinicalDerived read for ${date} failed closed: ${reason}`);
    this.name = 'ClinicalDerivedReadError';
  }
}

export interface ClinicalDerivedReadServiceOptions {
  mode: ClinicalDerivedReadMode;
  /** Read only this episode's document (a one-patient patch); others keep their embedded copy. */
  clinicalEpisodeId?: string;
  /**
   * Best-effort source; strict reads always go to the server. Callers that need a complete day
   * (export, staff tool) pass `server`; `default` may answer from the offline cache (`cache_only`).
   */
  source?: ClinicalDerivedReadSource;
  /**
   * Strict only: re-reads the day from the server once when a document is ahead of it. Without
   * it, or if the re-read is still behind, the read fails closed.
   */
  reloadRecord?: () => Promise<DailyRecord | null>;
}

export interface ClinicalDerivedReadResult {
  record: DailyRecord;
  /**
   * The un-overlaid day `record` was built from: after a strict re-read, the newer one. It is the
   * only valid write base for a caller acting on `record`.
   */
  day: DailyRecord;
  /** At least one episode took its fields from a document. */
  overlaid: boolean;
  /** Best-effort only: why some or all episodes may show their embedded copies. */
  fallbackReason?: ClinicalDerivedFallbackReason;
}

const isE2EOverrideActive = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.__HHR_E2E_OVERRIDE__);

const failureReason = (failure: ClinicalDerivedReadFailure): ClinicalDerivedFallbackReason =>
  failure.status === 'permission_denied' ? 'permission_denied' : 'read_failed';

/**
 * A strict read that fails closed for a reason the reader did not report (it reports failed reads):
 * operators can tell it from an ordinary record-load failure. Codes only, never the exception.
 */
const reportStrictFailClosed = (
  date: string,
  reason: ClinicalDerivedFallbackReason,
  readScope: 'day' | 'episode'
): void => {
  if (reason === 'read_failed' || reason === 'permission_denied') return;
  recordOperationalTelemetry({
    category: 'firestore',
    operation: 'clinical_derived_read',
    status: 'failed',
    runtimeState: 'blocked',
    date,
    issues: [reason],
    context: { readScope, reason },
  });
};

type DocsRead =
  | { status: 'resolved'; docs: ClinicalDerivedEpisodeDoc[]; fromCache: boolean }
  | ClinicalDerivedReadFailure;

const READER_UNAVAILABLE_CODE = 'reader_unavailable';

const readDocs = async (
  date: string,
  layoutGeneration: string,
  clinicalEpisodeId: string | undefined,
  source: ClinicalDerivedReadSource
): Promise<DocsRead> => {
  let reader: ClinicalDerivedEpisodeReaderModule;
  try {
    reader = await loadReader();
  } catch {
    return { status: 'failed', code: READER_UNAVAILABLE_CODE };
  }
  if (clinicalEpisodeId === undefined) {
    return reader.readClinicalDerivedEpisodeDocs(date, layoutGeneration, { source });
  }
  const result = await reader.readClinicalDerivedEpisodeDoc(
    date,
    layoutGeneration,
    clinicalEpisodeId,
    { source }
  );
  if (result.status !== 'resolved') return result;
  return { status: 'resolved', docs: result.doc ? [result.doc] : [], fromCache: result.fromCache };
};

/**
 * Overlays the day's episode documents on `record`. No read happens, and the record comes back
 * unchanged, when Firestore is disabled, under the E2E override, or when the day has no marker.
 */
export const readDailyRecordWithClinicalDerived = async (
  record: DailyRecord,
  options: ClinicalDerivedReadServiceOptions
): Promise<ClinicalDerivedReadResult> => {
  const strict = options.mode === 'strict';
  const source: ClinicalDerivedReadSource = strict ? 'server' : (options.source ?? 'default');
  // Same normalization as the overlay applies to the day's holders.
  const clinicalEpisodeId = options.clinicalEpisodeId?.trim();
  const fallBack = (
    reason: ClinicalDerivedFallbackReason,
    day: DailyRecord,
    code?: string
  ): ClinicalDerivedReadResult => {
    if (strict) {
      reportStrictFailClosed(day.date, reason, clinicalEpisodeId ? 'episode' : 'day');
      throw new ClinicalDerivedReadError(day.date, reason, code);
    }
    return { record: day, day, overlaid: false, fallbackReason: reason };
  };

  const overlayDay = async (day: DailyRecord): Promise<ClinicalDerivedReadResult | 'stale'> => {
    if (!isFirestoreEnabled() || isE2EOverrideActive())
      return { record: day, day, overlaid: false };
    const layout = readClinicalDerivedLayout(day);
    if (layout.status === 'unmarked') return { record: day, day, overlaid: false };
    if (layout.status === 'unsupported') return fallBack('unsupported_layout', day);

    const read = await readDocs(day.date, layout.layout.generation, clinicalEpisodeId, source);
    if (read.status !== 'resolved') return fallBack(failureReason(read), day, read.code);
    if (strict && findStaleClinicalDerivedEpisodeIds(day, read.docs).length > 0) return 'stale';

    const overlay = overlayClinicalDerived(day, read.docs);
    const result: ClinicalDerivedReadResult = {
      record: overlay.record,
      day,
      overlaid: overlay.matchedEpisodeIds.length > 0,
    };
    if (overlay.skippedDuplicateEpisodeIds.length > 0) {
      if (strict) fallBack('duplicate_episode', day);
      return { ...result, fallbackReason: 'duplicate_episode' };
    }
    return read.fromCache && !strict ? { ...result, fallbackReason: 'cache_only' } : result;
  };

  const first = await overlayDay(record);
  if (first !== 'stale') return first;
  // A document ahead of the day means the day read lags: read both again, once.
  const reloaded = options.reloadRecord ? await options.reloadRecord() : null;
  const second = reloaded ? await overlayDay(reloaded) : 'stale';
  return second === 'stale' ? fallBack('stale_day', reloaded ?? record) : second;
};

const FIRESTORE_DISABLED_CODE = 'firestore_disabled';

export type ClinicalDerivedDayDocsResult =
  | { status: 'unmarked' }
  | { status: 'resolved'; layoutGeneration: string; docs: ClinicalDerivedEpisodeDoc[] }
  | { status: 'unavailable'; reason: ClinicalDerivedFallbackReason; code?: string };

/**
 * Every current episode document of a day, active or not (discharged, transferred and CMA
 * episodes keep theirs), read from the server: the staff tool and the JSON backups. No read on an
 * unmarked day; a marked day that cannot be read is `unavailable`, never an empty list.
 */
export const readClinicalDerivedDayDocs = async (
  record: Pick<DailyRecord, 'date' | 'clinicalDerivedLayout'>
): Promise<ClinicalDerivedDayDocsResult> => {
  const layout = readClinicalDerivedLayout(record);
  if (layout.status === 'unmarked') return { status: 'unmarked' };
  if (layout.status === 'unsupported') {
    return { status: 'unavailable', reason: 'unsupported_layout' };
  }
  if (!isFirestoreEnabled() || isE2EOverrideActive()) {
    return { status: 'unavailable', reason: 'read_failed', code: FIRESTORE_DISABLED_CODE };
  }
  const generation = layout.layout.generation;
  const read = await readDocs(record.date, generation, undefined, 'server');
  if (read.status !== 'resolved') {
    return { status: 'unavailable', reason: failureReason(read), code: read.code };
  }
  return { status: 'resolved', layoutGeneration: generation, docs: read.docs };
};

export type ClinicalDerivedDisplayDocResult =
  | { status: 'skipped' }
  | { status: 'resolved'; doc: ClinicalDerivedEpisodeDoc | null; fromCache: boolean }
  | ClinicalDerivedReadFailure;

/**
 * One episode's current document for display (the vitals window): SDK default source, no
 * listener. `skipped`, without a read, when the id or the generation cannot be a document id,
 * without Firestore or under the E2E override. Failures come back typed: the caller keeps the
 * day's embedded copy.
 */
export const readClinicalDerivedEpisodeForDisplay = async (
  date: string,
  layoutGeneration: string,
  clinicalEpisodeId: string
): Promise<ClinicalDerivedDisplayDocResult> => {
  const episodeId = clinicalEpisodeId.trim();
  if (
    !isClinicalDerivedDocId(layoutGeneration) ||
    !isClinicalDerivedDocId(episodeId) ||
    !isFirestoreEnabled() ||
    isE2EOverrideActive()
  ) {
    return { status: 'skipped' };
  }
  const read = await readDocs(date, layoutGeneration, episodeId, 'default');
  return read.status === 'resolved'
    ? { status: 'resolved', doc: read.docs[0] ?? null, fromCache: read.fromCache }
    : read;
};
