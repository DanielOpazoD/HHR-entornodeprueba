import type { CudyrHistoryObservation } from './cudyrHistory';
import type { CudyrCaptureReceipt } from './cudyrCapture';
import type { CudyrDischargeCorrection, CudyrDischargeAudit } from './cudyrDischarge';

export type CudyrReportExportMode = 'statistics' | 'audit';

export type CudyrReportGroup = 'media' | 'intermedia' | 'sin_grupo';
export type CudyrReportModality = 'hospitalizacion' | 'cuna' | 'cma' | 'desconocida';
export type CudyrReportEligibility = 'elegible' | 'no_elegible' | 'por_revisar';
export type CudyrReportStatus =
  | 'registrado'
  | 'sin_registro_observado'
  | 'fuente_no_disponible'
  | 'sin_captura'
  | 'captura_incompleta'
  | 'guardado_pendiente'
  | 'por_revisar';

export interface CudyrReportEvaluation {
  category: string;
  source: string;
  recordedAt: string;
  sourceEvaluationId: string;
  author: string;
  authorId: string;
  authorRole: string;
  dependencyScore?: number | null;
  riskScore?: number | null;
  observationId?: string;
  metadataWarning?: string;
  items?: Array<{ fieldId: string; label?: string; typeId?: number | null; value: string }>;
}

export interface CudyrReportMovement {
  clinicalEpisodeId: string;
  censusDate: string;
  id: string;
  section: string;
  bedId: string;
  bedName: string;
  service: string;
  modality: CudyrReportModality;
  date: string;
  time: string;
  recordedAt: string;
  source: string;
  lineageId: string;
  medicalEpicrisisStatus: string;
  nursingEpicrisisStatus: string;
  epicrisisRegisteredAt: string;
}

/** Exactly one computable row per source episode and census day; unidentified legacy rows stay separate. */
export interface CudyrReportRow {
  key: string;
  date: string;
  clinicalEpisodeId: string;
  authorityDate: string;
  patientName: string;
  firstName: string;
  lastName: string;
  secondLastName: string;
  rut: string;
  documentType: string;
  diagnosis: string;
  diagnosisCode: string;
  identitySource: string;
  identitySourceDate: string;
  admissionDate: string;
  admissionTime: string;
  bedId: string;
  bedName: string;
  service: string;
  specialty: string;
  group: CudyrReportGroup;
  modality: CudyrReportModality;
  eligibility: CudyrReportEligibility;
  eligibilityReason: string;
  contextSource: string;
  referenceAt: string;
  cudyrStatus: CudyrReportStatus;
  evaluation: CudyrReportEvaluation | null;
  evaluationCount: number;
  lastCaptureAt: string;
  lastPersistedAt: string;
  captureActor: string;
  captureId: string;
  sourceRunId: string;
  dailyCudyrSavedAt: string;
  dailyCudyrSavedBy: string;
  medicalEpicrisisStatus: string;
  nursingEpicrisisStatus: string;
  epicrisisRegisteredAt: string;
  movements: CudyrReportMovement[];
  correction?: CudyrDischargeCorrection;
  warnings: string[];
}

export interface CudyrReportDayCoverage {
  date: string;
  state: 'disponible' | 'sin_censo' | 'error';
  lastSyncedAt: string;
  runId: string;
}
export interface CudyrReportDataset {
  schemaVersion: 1;
  from: string;
  to: string;
  generatedAt: string;
  rows: CudyrReportRow[];
  observations: CudyrHistoryObservation[];
  captures: CudyrCaptureReceipt[];
  corrections: CudyrDischargeCorrection[];
  dischargeAudit: CudyrDischargeAudit[];
  coverage: CudyrReportDayCoverage[];
  issues: string[];
}

export interface CudyrReportTotals {
  rows: number;
  eligible: number;
  categorized: number;
  withoutConfirmedResult: number;
  excluded: number;
  review: number;
  categories: Record<string, { media: number; intermedia: number }>;
}
