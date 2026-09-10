import type { RayenSyncReviewRequirement } from '@/types/domain/rayenSync';

export interface CapturePreparationLock {
  lockId: symbol;
  selectedDate: string;
}

export interface RayenImportCaptureOptions {
  /** Tightens one attempt to require human review without changing the global policy. */
  reviewRequirement?: RayenSyncReviewRequirement;
}
