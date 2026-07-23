import type { LabResultRow, SyslabExamItem } from './labExamTypes';

export type LabMicrobiologyCategory =
  | 'clostridium_difficile'
  | 'coprocultivo'
  | 'hemocultivo'
  | 'urocultivo'
  | 'otros_cultivos'
  | 'pcr_8_virus'
  | 'pcr_arbovirus';

/** A single data point for trend charts. */
export interface LabTrendPoint {
  date: string;
  isoDate: string;
  value: number;
  unit: string;
  /** Original Syslab value retained for clinical traceability in the chart tooltip. */
  rawValue?: string;
  /** PDF section/specimen that produced this point. */
  sourceSection?: string;
  refMin?: number;
  refMax?: number;
}

/** A group of related trend variables shown together in the UI. */
export interface LabTrendGroup {
  label: string;
  variables: Record<string, LabTrendPoint[]>;
}

/** Qualitative microbiology/culture result summarized per exam. */
export interface LabMicrobiologyEntry {
  category: LabMicrobiologyCategory;
  date: string;
  examLabel: string;
  findings: Array<{ analysis: string; result: string }>;
  hasAlertFinding: boolean;
  sourceExam: SyslabExamItem;
}

/** Processed analytics data built from multiple exam details. */
export interface LabAnalysisData {
  trendGroups: LabTrendGroup[];
  examDates: string[];
  comparison: Record<string, Record<string, LabResultRow>>;
  microbiologyEntries: LabMicrobiologyEntry[];
}

/** Active tab in the analysis view. */
export type AnalysisViewTab = 'trends' | 'comparison' | 'microbiology';
