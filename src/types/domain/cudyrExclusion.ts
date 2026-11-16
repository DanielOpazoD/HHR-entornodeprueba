export type CudyrExclusionReason =
  | 'cma'
  | 'healthy_crib'
  | 'not_hospitalized'
  | 'under_eight_hours';
/** Reasons a person may record on a discharge row that has no episode. */
export const CUDYR_EPISODELESS_EXCLUSION_REASONS = [
  'not_hospitalized',
  'under_eight_hours',
] as const satisfies readonly CudyrExclusionReason[];
export interface CudyrDailyExclusion {
  id: string;
  date: string;
  /** Empty when the decision belongs to a discharge without episode (`dischargeId`). */
  clinicalEpisodeId: string;
  /** Stored id of that day's discharge; only for rows without episode. */
  dischargeId?: string;
  revision: number;
  operationId: string;
  reason: CudyrExclusionReason | null;
  note: string;
  source: 'manual';
  updatedAt: string;
  updatedBy: { uid: string; name: string; email: string; role: string };
}
/** A row is either its confirmed episode or, without one, the discharge stored that day. */
export type CudyrExclusionTarget =
  | { clinicalEpisodeId: string; dischargeId?: never }
  | { dischargeId: string; clinicalEpisodeId?: never };
export type SaveCudyrExclusionRequest = CudyrExclusionTarget & {
  kind: 'save-daily-exclusion';
  schemaVersion: 1;
  date: string;
  expectedRevision: number;
  operationId: string;
  reason: CudyrExclusionReason | null;
  note: string;
  confirmed: true;
};
export const CUDYR_EXCLUSION_LABELS: Record<CudyrExclusionReason, string> = {
  cma: 'Cama CMA',
  healthy_crib: 'Cuna RN sano',
  not_hospitalized: 'UEA / fuera del servicio de hospitalización',
  under_eight_hours: 'Hospitalización < 8 horas al corte de 01:00 del día siguiente',
};
