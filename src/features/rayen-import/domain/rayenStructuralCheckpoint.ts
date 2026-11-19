import type { DailyRecord } from '@/types/domain/dailyRecord';
import { stableStringify } from './rayenStableStringify';

const structuralState = (record: DailyRecord) => ({
  beds: record.beds,
  activeExtraBeds: record.activeExtraBeds ?? [],
  discharges: record.discharges ?? [],
  transfers: record.transfers ?? [],
  cma: record.cma ?? [],
  rayenBedCollisionResolutions: record.rayenBedCollisionResolutions ?? [],
});

/** Metadata-only checkpointing is safe only when reconciliation leaves all structural state intact. */
export const hasUnchangedRayenStructuralState = (
  before: DailyRecord,
  after: DailyRecord
): boolean => stableStringify(structuralState(before)) === stableStringify(structuralState(after));
