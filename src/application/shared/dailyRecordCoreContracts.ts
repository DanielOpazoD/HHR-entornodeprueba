import type { DailyRecord as RootDailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch as RootDailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecordDateRef as RootDailyRecordDateRef } from '@/types/domain/dailyRecordSlices';
import type {
  ClinicalCribCreateRequest,
  IntentionalBedClearRequest,
} from '@/types/domain/intentionalBedClear';

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
   * exposing the mutation as successful. Used for destructive actions and
   * signed evaluations whose optimistic state must not imply durable persistence.
   */
  consistency?: 'eventual' | 'remote_confirmed';
  /** Reject concurrent journal writes instead of merging a stale signed evaluation. */
  requireAtomicCas?: boolean;
  /**
   * Reflect a remote-confirmed mutation immediately in the census while retaining rollback on
   * rejection. Reserved for narrow, reversible UI transitions such as clinical-crib lifecycle.
   */
  optimisticRemoteConfirmed?: boolean;
  /** Create-only intent bound to the parent episode and an empty remote crib slot. */
  clinicalCribCreate?: ClinicalCribCreateRequest;
  /** Explicit user-confirmed destructive intent; never inferred from an empty patch. */
  intentionalBedClear?: IntentionalBedClearRequest;
};

export type ApplyDailyRecordPatch = (
  patch: DailyRecordPatch,
  options?: ApplyDailyRecordPatchOptions
) => Promise<void>;
export type PersistDailyRecord = (record: DailyRecord) => Promise<void>;
