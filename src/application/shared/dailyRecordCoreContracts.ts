import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SpecialistHandoffTarget } from '@/types/domain/specialistHandoffTarget';

import type {
  ClinicalCribCreateRequest,
  IntentionalBedClearRequest,
} from '@/types/domain/intentionalBedClear';
import type { SpecialtyManualIntent } from '@/types/domain/specialtyDecision';

/** Options for this layer's daily-record writes. */

export type ApplyDailyRecordPatchOptions = {
  specialistHandoffTargets?: SpecialistHandoffTarget[];
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
  /** Exact online decision; cannot enter the generic offline merge queue. */
  specialtyIntent?: SpecialtyManualIntent;
};

export type ApplyDailyRecordPatch = (
  patch: DailyRecordPatch,
  options?: ApplyDailyRecordPatchOptions
) => Promise<void>;
export type PersistDailyRecord = (record: DailyRecord, baseRecord?: DailyRecord) => Promise<void>;
