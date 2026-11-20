import type { DailyRecord } from '@/types/domain/dailyRecord';

export type ClinicalEnrichmentBatchMode = 'enforced';

const isImportMode = (value: unknown): value is 'preview' | 'auto' =>
  value === 'preview' || value === 'auto';

export type ClinicalEnrichmentBatchPolicyResolution =
  | { runId: string; revision: number; sourceDate: string }
  | 'unavailable';

/** Resolves the immutable policy proof captured by the synchronization event. */
export const resolveClinicalEnrichmentBatchPolicyForRun = (
  record: Pick<DailyRecord, 'date' | 'rayenSync' | 'rayenSyncHistory'>,
  requestedRunId?: string
): ClinicalEnrichmentBatchPolicyResolution => {
  const runId = requestedRunId ?? record.rayenSync?.runId;
  if (!runId) return 'unavailable';
  const event = record.rayenSyncHistory?.find(candidate => candidate.id === runId);
  if (
    event?.status !== 'applied' ||
    !event.policy ||
    !Number.isInteger(event.policy.revision) ||
    event.policy.revision <= 0
  ) {
    return 'unavailable';
  }
  // A run recorded under a retired batch mode stays retryable instead of being written now.
  if (!isImportMode(event.policy.mode) || event.policy.clinicalBatchMode !== 'enforced') {
    return 'unavailable';
  }
  const sourceDate = event.sourceDate;
  if (sourceDate !== record.date) return 'unavailable';
  return { runId, revision: event.policy.revision, sourceDate };
};
