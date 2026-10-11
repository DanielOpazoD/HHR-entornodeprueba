import type { CudyrDailyExclusion } from './cudyrExclusion';
import type { CudyrHistoryObservation } from './cudyrHistory';
import type { CudyrCaptureReceipt } from './cudyrCapture';
import type { CudyrDischargeCorrection, CudyrDischargeAudit } from './cudyrDischarge';

export type CudyrReportExportMode = 'statistics' | 'audit';

export type CudyrReportGroup = 'media' | 'intermedia' | 'sin_grupo';
export type CudyrReportModality = 'hospitalizacion' | 'cuna' | 'cma' | 'uea' | 'desconocida';
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

export interface CudyrBedHistoryEntry {
  key: string;
  bed: string;
  service: string;
  modality: CudyrReportModality;
  startAt: string;
  endAt: string;
  observedAt: string;
  status: 'observada' | 'finalizada' | 'anulada' | 'contradictoria';
}

/** Exactly one computable row per source episode and census day; unidentified legacy rows stay separate. */
export interface CudyrReportRow {
  verifiedContext?: {
    revision: number;
    reviewedAt: string;
    reviewedBy: string;
    reason: string;
    evidenceHashes: string[];
    applicationTimingBasis: 'recorded_time' | 'assumed_before_0800';
  };
  /** Derived from report generation time; an open application window is not a compliance failure. */
  applicationPending?: boolean;
  monthlyEvidence?: {
    reportId: string;
    sourceDate: string;
    checkedAt: string;
    sourceRow?: number;
    linkMethod?: 'episode_timeline';
    identityMatch?: 'census_name_normalization';
    sourcePatientName?: string;
    state: 'found' | 'absent' | 'conflict';
  };
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
  admissionEvidenceConflict?: boolean;
  admissionDate: string;
  admissionTime: string;
  hospitalAdmissionAt?: string;
  hospitalStayAdmissionAt?: string;
  bedHistory?: CudyrBedHistoryEntry[];
  resolvedSystemDeparture?: boolean;
  hospitalAdmissionSource?: string;
  evaluationCapturedAt?: string;
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
  exclusion?: CudyrDailyExclusion;
  warnings: string[];
}

export interface CudyrReportDayCoverage {
  documentaryReconstruction?: { date: string; reason: string; evidenceHashes: string[] };
  reconstructionApproval?: { approvedAt: string; approvedBy: string; reason: string };
  censusVerification?: {
    state: 'pending' | 'verified' | 'mismatch';
    reportId?: string;
    reportIds?: string[];
    matched?: number;
    nightShiftMatched?: number;
    resultBacked?: number;
    unlinkedResults?: number;
    missing: number;
    extra: number;
    reason: string;
  };
  recordVersion?: string;
  date: string;
  state: 'disponible' | 'sin_censo' | 'error';
  lastSyncedAt: string;
  runId: string;
}
export interface CudyrReportDataset {
  officialSnapshot?: { version: string; savedAt: string; packed?: string };
  loadedAt?: string;
  schemaVersion: 1;
  from: string;
  to: string;
  generatedAt: string;
  rows: CudyrReportRow[];
  observations: CudyrHistoryObservation[];
  captures: CudyrCaptureReceipt[];
  corrections: CudyrDischargeCorrection[];
  dischargeAudit: CudyrDischargeAudit[];
  exclusions?: CudyrDailyExclusion[];
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
