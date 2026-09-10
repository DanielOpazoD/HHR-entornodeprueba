import type { RayenSyncReviewRequirement } from '@/types/domain/rayenSync';

export interface CapturePreparationLock {
  lockId: symbol;
  selectedDate: string;
}

export interface RayenImportCaptureOptions {
  /** Tightens one attempt to require human review without changing the global policy. */
  reviewRequirement?: RayenSyncReviewRequirement;
}

/**
 * What a capture attempt did with the operator's intent.
 * - `started`: a run exists (even if it failed right away); the day carries evidence of the attempt.
 * - `already_running`: an equivalent execution is in flight; the intent is redundant.
 * - `blocked`: nothing was recorded (policy still loading, previous clinical fill finishing,
 *   census not loaded yet). The caller may keep the intent and retry when the blocker clears.
 */
export type RayenImportTriggerOutcome = 'started' | 'already_running' | 'blocked';
