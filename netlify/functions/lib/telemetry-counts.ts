/**
 * Daily counts of operational telemetry, kept by the server so «how many resume failures were
 * there on the 9th?» stays answerable after Netlify's 7-day log window. Only bounded codes are
 * stored: operation, status and alert outcome. Event content (issues, context) never lands here.
 *
 * Read a day with: `netlify blobs:get operational-counts-v1-production daily/<YYYY-MM-DD>`
 * (the day is the hospital's calendar day in Rapa Nui).
 */
import { getStore, type Store } from '@netlify/blobs';
import { getClinicalCalendarDateISO } from '../../../src/utils/clinicalTimeZone';
import { createAlertBlobFetch, type TelemetryRuntimeContext } from './telemetry-alerts/store';

export interface TelemetryCountEntry {
  operation: string;
  status: string;
  alert: string;
  /** When the event arrived (ms). The day is that instant's, not the one after alert delivery. */
  receivedAt: number;
}

export interface DailyTelemetryCounts {
  date: string;
  /** operation → status → events received that day. */
  operations: Record<string, Record<string, number>>;
  /** Alert outcome (sent, not_alertable, queue_full…) → events. */
  alerts: Record<string, number>;
}

export type TelemetryCountResult = 'counted' | 'count_conflict' | 'count_failed' | 'count_timeout';

const CODE = /^[a-z0-9_]{1,80}$/;
/** A misbehaving client cannot grow a day without bound: further names count as «other». */
const MAX_OPERATIONS = 200;
const MAX_ATTEMPTS = 4;
/** Whole-operation limit, including the Blobs SDK's own retry waits. */
export const COUNT_BUDGET_MS = 2_500;

export const dailyCountsKey = (date: string): string => `daily/${date}`;

export const countsStoreName = (context: TelemetryRuntimeContext): string => {
  if (!context?.deploy?.id || !/^[a-zA-Z0-9-]{1,80}$/.test(context.deploy.id)) {
    throw new Error('count_deploy_context_missing');
  }
  // Previews and unpublished deploys count apart, so production numbers stay production only.
  return context.deploy.context === 'production' && context.deploy.published
    ? 'operational-counts-v1-production'
    : `operational-counts-v1-preview-${context.deploy.id}`;
};

const asCode = (value: string): string => (CODE.test(value) ? value : 'other');

export const addTelemetryCount = (
  current: DailyTelemetryCounts | null,
  date: string,
  entry: TelemetryCountEntry
): DailyTelemetryCounts => {
  const next: DailyTelemetryCounts =
    current && current.date === date
      ? structuredClone(current)
      : { date, operations: {}, alerts: {} };
  let operation = asCode(entry.operation);
  if (!next.operations[operation] && Object.keys(next.operations).length >= MAX_OPERATIONS) {
    operation = 'other';
  }
  const statuses = (next.operations[operation] ??= {});
  const status = asCode(entry.status);
  statuses[status] = (statuses[status] ?? 0) + 1;
  const alert = asCode(entry.alert);
  next.alerts[alert] = (next.alerts[alert] ?? 0) + 1;
  return next;
};

/** Compare-and-set on the day's document; a lost race is retried, never overwritten. */
export const createDailyTelemetryCounter =
  (store: Pick<Store, 'getWithMetadata' | 'setJSON'>) =>
  async (entry: TelemetryCountEntry): Promise<TelemetryCountResult> => {
    const date = getClinicalCalendarDateISO(new Date(entry.receivedAt));
    const key = dailyCountsKey(date);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (current && !current.etag) throw new Error('count_etag_missing');
      const next = addTelemetryCount(
        (current?.data as DailyTelemetryCounts | undefined) ?? null,
        date,
        entry
      );
      const write = await store.setJSON(
        key,
        next,
        current ? { onlyIfMatch: current.etag } : { onlyIfNew: true }
      );
      if (write.modified) return 'counted';
    }
    return 'count_conflict';
  };

export const createRuntimeTelemetryCounter = (context: TelemetryRuntimeContext) => {
  const deadlineAt = Date.now() + COUNT_BUDGET_MS;
  return createDailyTelemetryCounter(
    getStore({
      name: countsStoreName(context),
      consistency: 'strong',
      fetch: createAlertBlobFetch(fetch, deadlineAt),
    })
  );
};

/**
 * Bounds a count to COUNT_BUDGET_MS whatever the store does: on a 5xx the Blobs SDK sleeps between
 * its own retries even after the transport deadline, and the beacon must not wait for that.
 */
export const countWithinBudget = async (
  count: (entry: TelemetryCountEntry) => Promise<TelemetryCountResult>,
  entry: TelemetryCountEntry,
  budgetMs = COUNT_BUDGET_MS
): Promise<TelemetryCountResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TelemetryCountResult>(resolve => {
    timer = setTimeout(() => resolve('count_timeout'), budgetMs);
  });
  try {
    return await Promise.race([count(entry), timeout]);
  } catch {
    return 'count_failed';
  } finally {
    clearTimeout(timer);
  }
};
