/** Single exam entry returned by the Syslab search endpoint. */
export interface SyslabExamItem {
  id: string;
  link: string | null;
  date: string;
  time: string;
  patientName: string;
  origin: string;
  exams: string[];
}

export type SyslabPdfDownloadPhase = 'validating' | 'merging' | 'downloading';

export interface SyslabPdfDownloadProgress {
  phase: SyslabPdfDownloadPhase;
  completed: number;
  total: number;
  pageCount: number;
}

export interface SyslabPdfDownloadResult {
  filename: string;
  reportCount: number;
  pageCount: number;
  legacyExtension?: boolean;
}

export interface SyslabPdfDownloadStatus extends Omit<SyslabPdfDownloadProgress, 'phase'> {
  phase: SyslabPdfDownloadPhase | 'success';
  filename?: string;
  legacyExtension?: boolean;
}

/** A single parsed lab result row extracted from a PDF report. */
export interface LabResultRow {
  section: string;
  analysis: string;
  result: string;
  unit: string;
  refValue: string;
  qualitative?: boolean;
}

/** Detail response for a single exam (PDF parsed). */
export interface SyslabExamDetail {
  url: string;
  findings: LabResultRow[];
  error?: string;
}

/** Response from `GET /api/exams?rut=...` (exam list search). */
export interface SyslabSearchResponse {
  success: boolean;
  data: SyslabExamItem[];
  error?: string;
}

/** Response from `POST /api/exams/details` (PDF parsing). */
export interface SyslabDetailsResponse {
  success: boolean;
  data: SyslabExamDetail[];
  error?: string;
}

/** Patient option used by the lab viewer modal (same shape as radiology). */
export interface LabPatient {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  clinicalEpisodeId?: string;
  birthDate?: string;
  diagnosis?: string;
}
