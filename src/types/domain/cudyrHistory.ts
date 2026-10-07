/** An observed source version, not a selected daily result or evidence of clinical eligibility. */
export interface CudyrSourceEvaluation {
  clinicalEpisodeId: string;
  sourceEvaluationId: string;
  source: 'gestion_camas';
  recordedAt: string;
  category: string;
  authorId?: string;
  author?: string;
  authorRoleId?: string;
  authorRole?: string;
  /** Opaque source token: never interpret it as a modification date or ordering number. */
  sourceVersion?: string;
  isDeleted?: boolean;
  dependencyScore?: number | null;
  riskScore?: number | null;
  items?: Array<{ fieldId: string; label?: string; typeId?: number | null; value: string }>;
}

export interface ArchiveCudyrHistoryRequest {
  schemaVersion: 1;
  authorityDate: string;
  runId: string;
  evaluations: CudyrSourceEvaluation[];
}

export interface ArchiveCudyrHistoryResult {
  success: true;
  persisted: true;
  results: Array<{ id: string; eventKey: string; status: 'recorded' | 'already-recorded' }>;
}

export interface CudyrHistoryObservation {
  schemaVersion: 1;
  id: string;
  /** Groups revisions of one source evaluation; counting observations would overcount CUDYR. */
  eventKey: string;
  evaluation: CudyrSourceEvaluation;
  censusDate: string;
  attributionRule: 'hhr-night-v1';
  firstCapturedAt: string;
  firstCapturedBy: string;
  lastVerifiedAt: string;
  firstCaptureRunId: string;
  lastVerifiedRunId: string;
  captureCensusDate: string;
  /** Authoritative HHR contexts at first capture, not the bed at the time of evaluation. */
  captureContexts: Array<{
    clinicalEpisodeId: string;
    section: 'census' | 'crib' | 'discharges' | 'transfers' | 'cma';
    bedId: string;
    patientName?: string;
    firstName?: string;
    lastName?: string;
    secondLastName?: string;
    rut?: string;
    documentType?: string;
    pathology?: string;
    cie10Code?: string;
    admissionDate?: string;
    admissionTime?: string;
    bedName?: string;
    bedMode?: string;
    location?: string;
    specialty?: string;
  }>;
}

export interface CudyrHistoryCursor {
  date: string;
  id: string;
}
export interface ReadCudyrHistoryRequest {
  from: string;
  to: string;
  limit?: number;
  cursor?: CudyrHistoryCursor;
}
export interface ReadCudyrHistoryResult {
  observations: CudyrHistoryObservation[];
  nextCursor: CudyrHistoryCursor | null;
}
