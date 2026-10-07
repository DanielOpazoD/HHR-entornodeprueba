import type { CudyrSupplementReport } from './cudyrSupplement';

export interface CudyrDischargeReportRow {
  sourceRow: number;
  patientName: string;
  document: string;
  bed: string;
  service: string;
  diagnosis: string;
  date: string;
  time: string;
}
export interface CudyrDischargeReport {
  from: string;
  to: string;
  generatedLabel: string;
  rows: CudyrDischargeReportRow[];
}
export type CudyrReconciliationFile = {
  name: string;
  sha256: string;
} & (
  | { kind: 'categories'; report: CudyrSupplementReport }
  | { kind: 'discharges'; report: CudyrDischargeReport }
);
export type CudyrComparisonStatus =
  | 'compatible'
  | 'category_difference'
  | 'date_review'
  | 'identity_review'
  | 'no_hhr_candidate'
  | 'no_hhr_result'
  | 'discharge_review'
  | 'hhr_only';
export interface CudyrComparisonItem {
  key: string;
  source: string;
  sourceRow?: number;
  sourceDate: string;
  sourceValue: string;
  patientName: string;
  document: string;
  status: CudyrComparisonStatus;
  reason: string;
  candidateKeys: string[];
}
