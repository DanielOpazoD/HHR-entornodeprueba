import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

/**
 * Measures how big each day's census document is and how often a device receives a new
 * version of it. This is the measured stage for docs/ADR_DAILY_RECORD_DOCUMENT_GRANULARITY.md:
 * every new server version is a whole-document download, so size × versions approximates what
 * one day costs each device on the network.
 */

// The same fields the server drops from its slim history copies: per-bed data written by the
// clinical sync, not by hand. Their share says how much the day would shrink if they moved out.
const HEAVY_DERIVED_BED_FIELDS = [
  'clinicalSyncCheckpoint',
  'vitalSignsHistory',
  'evaluationScores',
] as const;

/** Firestore rejects documents over 1 MiB; warn with room to act. */
export const DAILY_RECORD_SIZE_WARNING_BYTES = 700_000;

/** Report the first server version of a day, then only these version counts. */
const REPORTED_VERSION_COUNTS = new Set([1, 10, 50, 200]);

export interface DailyRecordDocumentSize {
  /** Whole document as UTF-8 JSON bytes, an approximation of Firestore's own size. */
  sizeBytes: number;
  /** Heavy derived per-bed fields, cribs included. */
  derivedBytes: number;
  /** The Rayen sync log embedded in the day. */
  syncHistoryBytes: number;
  occupiedCount: number;
}

const encoder = new TextEncoder();

const jsonBytes = (value: unknown): number =>
  value === undefined ? 0 : encoder.encode(JSON.stringify(value)).length;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const measureDailyRecordDocument = (
  data: Record<string, unknown>
): DailyRecordDocumentSize => {
  let derivedBytes = 0;
  let occupiedCount = 0;
  const beds = isPlainRecord(data.beds) ? Object.values(data.beds) : [];
  for (const bed of beds) {
    if (!isPlainRecord(bed)) continue;
    if (typeof bed.patientName === 'string' && bed.patientName.trim()) occupiedCount += 1;
    for (const holder of [bed, bed.clinicalCrib]) {
      if (!isPlainRecord(holder)) continue;
      for (const field of HEAVY_DERIVED_BED_FIELDS) derivedBytes += jsonBytes(holder[field]);
    }
  }
  return {
    sizeBytes: jsonBytes(data),
    derivedBytes,
    syncHistoryBytes: jsonBytes(data.rayenSyncHistory),
    occupiedCount,
  };
};

const versionsByDate = new Map<string, { lastVersion: string; count: number }>();

const versionOf = (data: Record<string, unknown>): string => {
  const meta = isPlainRecord(data.meta) ? data.meta : {};
  return `${String(data.lastUpdated ?? '')}|${String(meta.revision ?? '')}`;
};

/**
 * Called with every server-confirmed snapshot of a day. Counts distinct versions per day for this
 * session and reports a few of them, so a busy day sends at most four events per device.
 */
export const observeDailyRecordServerSnapshot = (
  date: string,
  data: Record<string, unknown>
): void => {
  const version = versionOf(data);
  const state = versionsByDate.get(date) ?? { lastVersion: '', count: 0 };
  if (state.count > 0 && state.lastVersion === version) return;
  state.lastVersion = version;
  state.count += 1;
  versionsByDate.set(date, state);
  if (!REPORTED_VERSION_COUNTS.has(state.count)) return;

  const size = measureDailyRecordDocument(data);
  const oversized = size.sizeBytes >= DAILY_RECORD_SIZE_WARNING_BYTES;
  recordOperationalTelemetry(
    {
      category: 'daily_record',
      operation: 'daily_record_size_observed',
      status: oversized ? 'degraded' : 'success',
      ...(oversized
        ? {
            runtimeState: 'degraded' as const,
            issues: ['El registro del día supera 700 KB; Firestore no acepta más de 1 MiB.'],
          }
        : {}),
      date,
      context: { ...size, count: state.count },
    },
    { allowSuccess: true }
  );
};
