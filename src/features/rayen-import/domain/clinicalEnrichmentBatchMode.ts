import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';

export type ClinicalEnrichmentBatchMode = 'enforced';
export type ClinicalEnrichmentBatchModeResolution = ClinicalEnrichmentBatchMode | 'unavailable';

const isImportMode = (value: unknown): value is 'preview' | 'auto' =>
  value === 'preview' || value === 'auto';

export type ClinicalEnrichmentBatchPolicyResolution =
  | (RayenClinicalWriteGuard & { clinicalBatchMode: 'enforced' })
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
  const clinicalBatchMode = event.policy.clinicalBatchMode;
  if (!isImportMode(event.policy.mode) || clinicalBatchMode !== 'enforced') {
    return 'unavailable';
  }
  const sourceDate = event.sourceDate;
  if (sourceDate !== record.date) return 'unavailable';
  return {
    runId,
    importMode: event.policy.mode,
    clinicalBatchMode,
    revision: event.policy.revision,
    sourceDate,
    recordScope: 'run',
  };
};

/**
 * Resolves the immutable server-confirmed mode captured by the synchronization run.
 * Missing, stale or retired-mode evidence leaves the clinical pass retryable.
 */
export const resolveClinicalEnrichmentBatchModeForRun = (
  record: Pick<DailyRecord, 'date' | 'rayenSync' | 'rayenSyncHistory'>,
  requestedRunId?: string
): ClinicalEnrichmentBatchModeResolution => {
  const policy = resolveClinicalEnrichmentBatchPolicyForRun(record, requestedRunId);
  return policy === 'unavailable' ? policy : policy.clinicalBatchMode;
};
