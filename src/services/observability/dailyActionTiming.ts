/**
 * How long the day's routine actions take for the people using the app, as one counted duration
 * per action. Nothing else travels: no date, bed, patient, user or free text, only the operation,
 * whether it completed, and `durationMs`.
 *
 * These events go straight to the external endpoint and skip the local event buffer. An edit is
 * saved many times per shift, and the local buffer keeps only the last 200 events: timings would
 * push out the failures that local diagnostics and the system health report depend on.
 * Successful Eloísa syncs are not repeated here; their stages live in `rayenSyncHistory.performance`.
 */
import { dispatchOperationalTelemetryExternally } from './operationalTelemetryExternalAdapter';
import type { OperationalTelemetryCategory } from './operationalTelemetryTypes';

const DAILY_ACTION_CATEGORIES = {
  /** Another day chosen in the census, until its census (or its confirmed absence) is shown. */
  census_day_change_ready: 'daily_record',
  /** A census edit, until the server confirms it (`success`) or it stays local or fails. */
  census_edit_saved: 'daily_record',
  /** A patient's clinical panel opened, until Eloísa's reading is shown or fails. */
  clinical_panel_ready: 'integration',
} as const satisfies Record<string, OperationalTelemetryCategory>;

export type DailyAction = keyof typeof DAILY_ACTION_CATEGORIES;

export const dailyActionNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * `completed: false` means the action ended without the expected result (`degraded`, never
 * `failed`: a slow or unconfirmed action is counted, it never mails anyone).
 */
export const recordDailyActionTiming = (
  action: DailyAction,
  startedAt: number,
  completed: boolean,
  endedAt: number = dailyActionNow()
): void => {
  void dispatchOperationalTelemetryExternally({
    category: DAILY_ACTION_CATEGORIES[action],
    operation: action,
    status: completed ? 'success' : 'degraded',
    timestamp: new Date().toISOString(),
    context: { durationMs: Math.max(0, Math.round(endedAt - startedAt)) },
  });
};
