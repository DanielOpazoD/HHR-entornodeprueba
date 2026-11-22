import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

export type AdmissionDateBackfillScope = 'bed' | 'clinicalCrib' | 'discharge' | 'transfer';

export interface AdmissionDateBackfillSample {
  scope: AdmissionDateBackfillScope;
  date: string;
  bedId: string;
  bedName: string;
  patientName: string;
  rut: string;
  previousAdmissionDate?: string;
  suggestedAdmissionDate: string;
  firstSeenDate: string;
}

export interface AdmissionDateBackfillResult {
  scannedDays: number;
  reviewedEntries: number;
  correctionCount: number;
  touchedRecords: number;
  appliedRecords: number;
  failedRecords: number;
  outcome: 'clean' | 'repaired' | 'partial' | 'blocked';
  samples: AdmissionDateBackfillSample[];
  userSafeMessage: string;
}

export interface BackfillTarget {
  scope: AdmissionDateBackfillScope;
  patient: PatientData;
  date: string;
  bedId: string;
  bedName: string;
}

export interface RecordPlan {
  record: DailyRecord;
  corrections: AdmissionDateBackfillSample[];
}

export interface AdmissionDateBackfillPlan {
  records: RecordPlan[];
  scannedDays: number;
  reviewedEntries: number;
}
