import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  findStaleClinicalDerivedEpisodeIds,
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
    if (strict) throw new ClinicalDerivedReadError(day.date, reason, code);
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
      if (strict) throw new ClinicalDerivedReadError(day.date, 'duplicate_episode');
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
