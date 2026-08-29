import type { DailyRecord as RootDailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch as RootDailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecordDateRef as RootDailyRecordDateRef } from '@/types/domain/dailyRecordSlices';

/**
 * Core application-facing daily record contracts.
 *
 * This is the default entrypoint for general record read/update flows that do
 * not need bed-, staffing- or medical-specific slices.
 */
export type DailyRecord = RootDailyRecord;
export type DailyRecordPatch = RootDailyRecordPatch;
export type DailyRecordDateRef = RootDailyRecordDateRef;

export type ApplyDailyRecordPatchOptions = {
  /**
   * Wait for the remote authority to return the exact committed record before
   * exposing the mutation as successful. Reserved for destructive actions
   * whose optimistic state must never be mistaken for durable persistence.
   */
  consistency?: 'eventual' | 'remote_confirmed';
  /** Explicit user-confirmed destructive intent; never inferred from an empty patch. */
  intentionalBedClear?: { bedId: string; confirmedLastUpdated: string };
};

export type ApplyDailyRecordPatch = (
  patch: DailyRecordPatch,
  options?: ApplyDailyRecordPatchOptions
) => Promise<void>;
export type PersistDailyRecord = (record: DailyRecord) => Promise<void>;
