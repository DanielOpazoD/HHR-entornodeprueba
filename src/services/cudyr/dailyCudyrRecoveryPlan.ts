import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/types/domain/patient';
import type { CapturedCudyrMonthlyReport } from './cudyrMonthlyReportCapture';
import { cudyrDocumentKey, cudyrIdentity } from '@/domain/cudyr/cudyrSourceIdentity';
import { buildImportedCudyr } from '@/domain/evaluationScales/importedCudyr';
import {
  CUDYR_DOCUMENTARY_SOURCE,
  hasAcceptedCudyr,
  hasUniqueDocumentaryCudyrIdentity,
  isProtectedCudyrDay,
  type DocumentaryCudyr,
} from '@/domain/evaluationScales/documentaryCudyr';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { cudyrModality } from '@/domain/cudyr/cudyrModality';
import { isCudyrPatientEligible } from '@/domain/cudyr/cudyrEligibility';
import { isValidRut } from '@/utils/rutUtils';
import { getNextDay } from '@/utils/clinicalDayUtils';
import type { CudyrCategoryInput } from '@/domain/evaluationScales/importedCudyr';

const patients = (record: DailyRecord): PatientData[] =>
  Object.values(record.beds).flatMap(p => (p.clinicalCrib ? [p, p.clinicalCrib] : [p]));

const recoveryCandidates = (record: DailyRecord) =>
  Object.entries(record.beds).flatMap(([bedId, patient]) => {
    const candidates: {
      patient: PatientData;
      bedId: string;
      section: 'census' | 'crib';
    }[] = [{ patient, bedId, section: 'census' }];
    if (patient.clinicalCrib)
      candidates.push({ patient: patient.clinicalCrib, bedId, section: 'crib' });
    return candidates;
  });

const hasDocumentaryIdentity = (patient: PatientData): boolean =>
  patient.documentType === 'RUT' &&
  isValidRut(patient.rut) &&
  Boolean(patient.patientName.trim()) &&
  !patient.neonatalMaternalRut &&
  patient.identityStatus !== 'provisional';

export interface DailyCudyrGap {
  clinicalEpisodeId: string;
  date: string;
  patient: PatientData;
  sourceDate: string;
}

/** Only two existing census days; neither an absent live episode nor a blank XLS is a discharge. */
export const planDailyCudyrGaps = (
  records: readonly DailyRecord[],
  episodeIds: readonly string[],
  source: { map: ReadonlyMap<string, CudyrCategoryInput>; historyAvailable: boolean },
  now: Date
): DailyCudyrGap[] =>
  records.flatMap(record => {
    if (
      isProtectedCudyrDay(record) ||
      resolveCudyrPendingStatus(record.date, now).phase !== 'overdue'
    )
      return [];
    return recoveryCandidates(record).flatMap(({ patient, bedId, section }) => {
      const modality = cudyrModality({ ...patient, bedId, section });
      if (
        (modality === 'cuna' || modality === 'cma' || modality === 'uea') &&
        !hasDocumentaryIdentity(patient)
      )
        return [];
      const id = patient.clinicalEpisodeId;
      const live = id ? source.map.get(id) : undefined;
      return id &&
        episodeIds.includes(id) &&
        !hasAcceptedCudyr(patient) &&
        !(
          live &&
          (record.date === records[0]?.date ||
            (source.historyAvailable && live.source === 'gestion_camas')) &&
          buildImportedCudyr(live, record.date)
        )
        ? [
            {
              clinicalEpisodeId: id,
              date: record.date,
              patient,
              sourceDate: getNextDay(record.date),
            },
          ]
        : [];
    });
  });

export type DailyCudyrGapResolution =
  | { kind: 'recovered'; cudyr: DocumentaryCudyr }
  | { kind: 'attribution_unreliable' }
  | { kind: 'documentary_inconclusive' }
  // CUD-07: no record was expected, so a blank report is the answer rather than a missing one.
  | { kind: 'not_applicable' };

/** No name-only, bed, maternal-document or duplicate-episode attribution. Blank means unknown. */
export const recoverDailyCudyrGap = (
  gap: DailyCudyrGap,
  records: readonly DailyRecord[],
  source: CapturedCudyrMonthlyReport
): DailyCudyrGapResolution => {
  const { patient, sourceDate } = gap;
  const withoutCategory = (): DailyCudyrGapResolution =>
    isCudyrPatientEligible(gap.date, patient)
      ? { kind: 'documentary_inconclusive' }
      : { kind: 'not_applicable' };
  if (
    records.some(
      record =>
        patients(record).filter(p => p.clinicalEpisodeId === patient.clinicalEpisodeId).length > 1
    )
  )
    return { kind: 'attribution_unreliable' };
  if (patient.clinicalEpisodeId !== gap.clinicalEpisodeId || !hasDocumentaryIdentity(patient))
    return { kind: 'attribution_unreliable' };
  if (source.report.month !== sourceDate.slice(0, 7)) return { kind: 'documentary_inconclusive' };
  const document = cudyrDocumentKey(patient.rut);
  const identity = cudyrIdentity(patient.rut, patient.patientName);
  if (
    !hasUniqueDocumentaryCudyrIdentity(
      records.filter(record => record.date === gap.date || record.date === sourceDate),
      patient
    )
  )
    return { kind: 'attribution_unreliable' };
  // A repeated documentary row may represent a readmission; do not pick the latest/first row.
  const rows = source.report.patients.filter(p => cudyrDocumentKey(p.document) === document);
  if (rows.length === 0) return withoutCategory();
  if (rows.length !== 1 || cudyrIdentity(rows[0].document, rows[0].patientName) !== identity)
    return { kind: 'attribution_unreliable' };
  const cells = rows[0].days.filter(d => d.sourceDate === sourceDate);
  const category = cells[0]?.category;
  if (
    !category ||
    cells.length !== 1 ||
    cells[0].state !== 'category' ||
    !/^[A-D][1-3]$/.test(category)
  )
    return withoutCategory();
  return {
    kind: 'recovered',
    cudyr: {
      category,
      recordedDate: gap.date,
      source: CUDYR_DOCUMENTARY_SOURCE,
      documentaryEvidence: {
        reportId: source.reportId,
        sourceRow: rows[0].sourceRow,
        sourceDate,
        clinicalEpisodeId: gap.clinicalEpisodeId,
        document: patient.rut,
        patientName: patient.patientName,
        documentType: 'RUT',
      },
    },
  };
};
