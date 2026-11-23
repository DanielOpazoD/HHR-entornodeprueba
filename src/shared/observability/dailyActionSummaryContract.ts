/**
 * What a daily-action timing summary may carry, shared by the browser producer and the Netlify
 * ingest. Dependency-free so the ingest can import it without the browser adapter.
 */
export const DAILY_ACTION_OPERATIONS = [
  /** Another day chosen in the census, until its census (or its confirmed absence) is shown. */
  'census_day_change_ready',
  /** A census edit, until the server confirms it, or it stays local or fails (`degraded`). */
  'census_edit_saved',
  /** A patient's clinical panel opened, until Eloísa's reading is shown or fails. */
  'clinical_panel_ready',
] as const;

export type DailyAction = (typeof DAILY_ACTION_OPERATIONS)[number];

/** The only context a summary keeps: closed, bounded numbers. No date, bed, patient or text. */
export const DAILY_ACTION_SUMMARY_KEYS = [
  'count',
  'degradedCount',
  'p50Ms',
  'p90Ms',
  'maxMs',
] as const;

const DAILY_ACTIONS: ReadonlySet<string> = new Set(DAILY_ACTION_OPERATIONS);

export const isDailyActionOperation = (operation: string): operation is DailyAction =>
  DAILY_ACTIONS.has(operation);
