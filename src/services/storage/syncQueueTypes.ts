/**
 * Sync queue task contracts shared by storage services.
 */
export interface SyncTask {
  id?: number;
  type: 'UPDATE_DAILY_RECORD' | 'UPDATE_PATIENT';
  payload: unknown;
  timestamp: number;
  retryCount: number;
  nextAttemptAt?: number;
  status: 'PENDING' | 'PROCESSING' | 'FAILED';
  error?: string;
  key?: string;
}
