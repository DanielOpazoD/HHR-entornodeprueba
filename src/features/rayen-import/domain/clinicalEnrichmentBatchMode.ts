import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';

export type ClinicalEnrichmentBatchMode = 'off' | 'shadow' | 'enforced';
export type ClinicalEnrichmentBatchModeResolution = ClinicalEnrichmentBatchMode | 'unavailable';

/** Only pre-authoritative modes may persist through the established per-record writer. */
export const usesLegacyClinicalWriter = (mode: ClinicalEnrichmentBatchMode): boolean =>
  mode === 'off' || mode === 'shadow';

const isClinicalEnrichmentBatchMode = (value: unknown): value is ClinicalEnrichmentBatchMode =>
  value === 'off' || value === 'shadow' || value === 'enforced';

const isImportMode = (value: unknown): value is 'preview' | 'auto' =>
  value === 'preview' || value === 'auto';

export type ClinicalEnrichmentBatchPolicyResolution = RayenClinicalWriteGuard | 'unavailable';

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
    event.policy.revision < 0
  ) {
    return 'unavailable';
  }
  const value = event.policy.clinicalBatchMode;
  const clinicalBatchMode = value === undefined ? 'off' : value;
  if (!isImportMode(event.policy.mode) || !isClinicalEnrichmentBatchMode(clinicalBatchMode)) {
    return 'unavailable';
  }
  // Before the global policy document existed, the server-confirmed safe default was revision 0
  // with clinical batching disabled. No other revision-zero mode is authoritative.
  if (event.policy.revision === 0 && clinicalBatchMode !== 'off') return 'unavailable';
  const sourceDate = event.sourceDate ?? record.date;
  if (sourceDate !== record.date) return 'unavailable';
  if (clinicalBatchMode !== 'off' && !event.sourceDate) return 'unavailable';
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
 * A persisted legacy event is the only implicit `off` compatibility case. Missing or stale
 * evidence is not a rollback decision and must leave the clinical pass retryable.
 */
export const resolveClinicalEnrichmentBatchModeForRun = (
  record: Pick<DailyRecord, 'date' | 'rayenSync' | 'rayenSyncHistory'>,
  requestedRunId?: string
): ClinicalEnrichmentBatchModeResolution => {
  const policy = resolveClinicalEnrichmentBatchPolicyForRun(record, requestedRunId);
  return policy === 'unavailable' ? policy : policy.clinicalBatchMode;
};
