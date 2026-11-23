export type SyncDomainContext =
  | 'clinical'
  | 'staffing'
  | 'movements'
  | 'handoff'
  | 'metadata'
  | 'unknown';

/** Closed list: operational telemetry reports a conflict's origin only as one of these. */
export const SYNC_TASK_ORIGINS = [
  'backup_restore',
  'direct_queue',
  'full_save_retry',
  'partial_update_retry',
  'conflict_auto_merge',
] as const;

export type SyncTaskOrigin = (typeof SYNC_TASK_ORIGINS)[number];
