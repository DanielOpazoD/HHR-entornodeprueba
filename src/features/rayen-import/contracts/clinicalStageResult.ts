import type { DailyRecord } from './rayenDomainContracts';
import type { ConfirmedRayenCensusHandoff } from '../hooks/rayenCensusPersistenceGuard';
import type { ClinicalFillSummary } from './clinicalFillContracts';

export interface ClinicalRetryToken {
  readonly type: 'clinical_retry';
  readonly source: DailyRecord | ConfirmedRayenCensusHandoff;
  readonly pendingClinicalEpisodeIds: readonly string[];
  /** Aggregate from earlier attempts; used only to preserve run-level audit evidence. */
  readonly previousSummary?: ClinicalFillSummary;
}

export type ClinicalFillRequest =
  | DailyRecord
  | ConfirmedRayenCensusHandoff
  | ClinicalRetryToken;

export type ClinicalStageResult =
  | { status: 'complete' }
  | { status: 'partial'; retry: ClinicalRetryToken }
  | { status: 'failed'; retry?: ClinicalRetryToken };

export const isClinicalRetryToken = (
  value: ClinicalFillRequest
): value is ClinicalRetryToken =>
  'type' in value && value.type === 'clinical_retry';
