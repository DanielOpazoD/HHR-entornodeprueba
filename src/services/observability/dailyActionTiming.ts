/**
 * How long the day's routine actions take for the people using the app.
 *
 * Each action's duration is kept in memory for this tab and leaves as one summary per action
 * (`count`, `degradedCount`, `p50Ms`, `p90Ms`, `maxMs`) every 15 minutes, or when the tab is hidden
 * or closed, and only if there was an action. So a whole shift of edits costs at most three
 * requests per window and never competes with a real failure for the endpoint's per-IP limit.
 *
 * A window belongs to one session. It is measured only while its owner (the authenticated app) is
 * mounted, and a session change, a logout or the owner unmounting cancels the timer and drops the
 * window unsent: nothing measured for one person is ever summarised with the next one's.
 *
 * Summaries go straight to the external endpoint and skip the local 200-event buffer, which keeps
 * the failures that local diagnostics and the system health report depend on.
 * Successful Eloísa syncs are not repeated here; their stages live in `rayenSyncHistory.performance`.
 */
import { onSessionChange } from '@/services/session/sessionStorageTransition';
import { dispatchOperationalTelemetryExternally } from './operationalTelemetryExternalAdapter';
import type { OperationalTelemetryCategory } from './operationalTelemetryTypes';
import type { DailyAction } from './dailyActionSummaryContract';

export type { DailyAction } from './dailyActionSummaryContract';

const CATEGORIES: Record<DailyAction, OperationalTelemetryCategory> = {
  census_day_change_ready: 'daily_record',
  census_edit_saved: 'daily_record',
  clinical_panel_ready: 'integration',
};

export const DAILY_ACTION_SUMMARY_INTERVAL_MS = 15 * 60 * 1000;
/** Percentiles come from the first samples of a window; `count` and `maxMs` still see every one. */
const MAX_SAMPLES = 500;

interface ActionWindow {
  samples: number[];
  count: number;
  degradedCount: number;
  maxMs: number;
}

const windows = new Map<DailyAction, ActionWindow>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** Mounted owners; listeners exist once, however often the owner mounts again. */
let owners = 0;
let stopListening: (() => void) | undefined;

export const dailyActionNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** Nearest-rank percentile of an ascending list; a window always holds at least one sample. */
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;

/** Sends one summary per action measured since the last one, then starts a new window. */
export const flushDailyActionTimings = (): void => {
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
  const timestamp = new Date().toISOString();
  for (const [action, bucket] of windows) {
    const sorted = [...bucket.samples].sort((a, b) => a - b);
    void dispatchOperationalTelemetryExternally({
      category: CATEGORIES[action],
      operation: action,
      status: 'success',
      timestamp,
      context: {
        count: bucket.count,
        degradedCount: bucket.degradedCount,
        p50Ms: percentile(sorted, 0.5),
        p90Ms: percentile(sorted, 0.9),
        maxMs: bucket.maxMs,
      },
    });
  }
  windows.clear();
};

const flushWhenHidden = (): void => {
  if (document.visibilityState === 'hidden') flushDailyActionTimings();
};

/** Cancels the timer and drops the window unsent. */
const discardDailyActionTimings = (): void => {
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
  windows.clear();
};

/** Starts measuring for the owner that calls it and returns that owner's cleanup. */
export const startDailyActionTiming = (): (() => void) => {
  owners += 1;
  if (owners === 1 && typeof window !== 'undefined') {
    const stopSession = onSessionChange(discardDailyActionTimings);
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushDailyActionTimings);
    stopListening = () => {
      stopSession();
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushDailyActionTimings);
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    owners -= 1;
    if (owners > 0) return;
    stopListening?.();
    stopListening = undefined;
    discardDailyActionTimings();
  };
};

/**
 * `completed: false` means the action ended without the expected result; it is counted in
 * `degradedCount`. A summary is never `failed`, so it never mails anyone.
 */
export const recordDailyActionTiming = (
  action: DailyAction,
  startedAt: number,
  completed: boolean,
  endedAt: number = dailyActionNow()
): void => {
  if (owners === 0) return;
  const durationMs = Math.max(0, Math.round(endedAt - startedAt));
  const bucket = windows.get(action) ?? { samples: [], count: 0, degradedCount: 0, maxMs: 0 };
  windows.set(action, bucket);
  bucket.count += 1;
  if (!completed) bucket.degradedCount += 1;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);
  if (bucket.samples.length < MAX_SAMPLES) bucket.samples.push(durationMs);
  flushTimer ??= setTimeout(flushDailyActionTimings, DAILY_ACTION_SUMMARY_INTERVAL_MS);
};
