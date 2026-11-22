import { cudyrNameKey } from '@/domain/cudyr/cudyrSourceIdentity';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';

export interface CudyrVerifiedContextEntry {
  date: string;
  reportId: string;
  sourceRow: number | null;
  /** Documentary RN identity: this specific source row belongs to the mother, never the child. */
  maternalSourceRow?: number;
  patientName?: string;
  clinicalEpisodeId: string;
  admissionAt: string;
  dischargeAt: string;
  modality: 'hospitalizacion' | 'cuna' | 'cma' | 'uea';
  group: CudyrReportRow['group'];
  bedId: string;
  bedName: string;
  document: string;
  documentType: string;
  basis: 'reviewed_documentary_context' | 'reviewed_report_absence';
  reason: string;
  evidenceHashes: string[];
}

export interface CudyrVerifiedContext {
  censusApproval?: import('./cudyrCensusApproval').CudyrCensusApproval;
  schemaVersion: 1;
  month: string;
  revision: number;
  entries: CudyrVerifiedContextEntry[];
  reconstructedDays?: Array<{ date: string; reason: string; evidenceHashes: string[] }>;
  reviewedBy: { uid: string; name: string; email: string; role: string };
  updatedAt: string;
  /** `census_approval_only`: created by an approval of a month that needed no reconciliation. */
  verification: 'reviewed_documentary_context' | 'census_approval_only';
  files: Array<{ name: string; sha256: string; byteLength: number }>;
}

export type ReviewedTimingBasis = NonNullable<
  CudyrReportRow['verifiedContext']
>['applicationTimingBasis'];

/** Rows, issues and final sources shared by every reviewed entry of one report pass. */
export interface VerifiedContextPass {
  rows: CudyrReportRow[];
  issues: string[];
  sources: ArchivedCudyrSupplement[];
  now: Date;
}

export const HOUR_MS = 3600000;
export const VERIFIED_ADMISSION_SOURCE = 'Conciliación documental verificada · Eloísa / censo HHR';

/** Name key with only letters and digits, so a reviewed name matches its source spelling. */
export const compactNameKey = (value: string) => cudyrNameKey(value).replace(/[^A-Z0-9]/g, '');

export const byEpisodeDay = (rows: CudyrReportRow[], entry: CudyrVerifiedContextEntry) =>
  rows.filter(r => r.date === entry.date && r.clinicalEpisodeId === entry.clinicalEpisodeId);

/** CUD-03/CUD-04: why a reviewed context is not eligible; `fallback` when none of the exclusions apply. */
export const reviewedExclusionReason = (
  modality: CudyrVerifiedContextEntry['modality'],
  hours: number,
  fallback: string
) =>
  modality === 'cuna'
    ? 'Cuna: exclusión diaria CUDYR.'
    : modality === 'cma'
      ? 'CMA: exclusión diaria CUDYR.'
      : modality === 'uea'
        ? 'UEA: cama de Urgencias excluida de CUDYR.'
        : hours < 8
          ? 'Hospitalización menor de 8 horas al corte de 01:00 del día siguiente.'
          : fallback;

/** A reviewed stay must have a real admission strictly before its discharge. */
export const reviewedStayIsValid = (entry: CudyrVerifiedContextEntry) => {
  const admission = Date.parse(entry.admissionAt);
  const discharge = Date.parse(entry.dischargeAt);
  return Number.isFinite(admission) && Number.isFinite(discharge) && discharge > admission;
};

export const reviewedContext = (
  review: CudyrVerifiedContext,
  entry: CudyrVerifiedContextEntry,
  applicationTimingBasis: ReviewedTimingBasis
): NonNullable<CudyrReportRow['verifiedContext']> => ({
  revision: review.revision,
  reviewedAt: review.updatedAt,
  reviewedBy: review.reviewedBy.name,
  reason: entry.reason,
  evidenceHashes: entry.evidenceHashes,
  applicationTimingBasis,
});
