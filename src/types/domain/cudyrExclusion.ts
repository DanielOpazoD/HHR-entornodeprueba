export type CudyrExclusionReason =
  | 'cma'
  | 'healthy_crib'
  | 'not_hospitalized'
  | 'under_eight_hours';
export interface CudyrDailyExclusion {
  id: string;
  date: string;
  clinicalEpisodeId: string;
  revision: number;
  operationId: string;
  reason: CudyrExclusionReason | null;
  note: string;
  source: 'manual';
  updatedAt: string;
  updatedBy: { uid: string; name: string; email: string; role: string };
}
export interface SaveCudyrExclusionRequest {
  kind: 'save-daily-exclusion';
  schemaVersion: 1;
  date: string;
  clinicalEpisodeId: string;
  expectedRevision: number;
  operationId: string;
  reason: CudyrExclusionReason | null;
  note: string;
  confirmed: true;
}
export const CUDYR_EXCLUSION_LABELS: Record<CudyrExclusionReason, string> = {
  cma: 'Cama CMA',
  healthy_crib: 'Cuna RN sano',
  not_hospitalized: 'Paciente fuera del hospital, pendiente de regularización',
  under_eight_hours: 'Hospitalización menor de 8 horas',
};
