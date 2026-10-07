/** A monthly report is documentary evidence, never an individual clinical application. */
export interface CudyrSupplementDay {
  sourceDay: number;
  sourceColumn: number;
  sourceDate: string;
  originalValue: string;
  category: string | null;
  state: 'category' | 'blank' | 'uncategorized';
}

export interface CudyrSupplementPatient {
  sourceRow: number;
  ordinal: number;
  patientName: string;
  clinicalRecord: string;
  document: string;
  diagnosis: string;
  hospitalDays: string;
  service: string;
  dischargeCondition: string;
  days: CudyrSupplementDay[];
}

export interface CudyrSupplementReport {
  schemaVersion: 1;
  source: 'eloisa_monthly_report';
  month: string;
  establishment: string;
  /** Literal source label, with no assumed timezone or download timestamp. */
  generatedLabel: string;
  sheet: string;
  patients: CudyrSupplementPatient[];
}

export interface CudyrSupplementParseIssue {
  row: number;
  column: number;
  code: 'structure' | 'period' | 'value' | 'limit';
  message: string;
}

export type CudyrSupplementParseResult =
  | { ok: true; report: CudyrSupplementReport }
  | { ok: false; issues: CudyrSupplementParseIssue[] };

/** Reader boundary: values only. The XLS adapter must reject formulas before normalization. */
export interface CudyrSupplementMatrix {
  sheet: string;
  rows: unknown[][];
}
