import type { DailyRecord } from '@/types/domain/dailyRecord';
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
import { isValidRut } from '@/utils/rutUtils';
import { getNextDay } from '@/utils/clinicalDayUtils';
import type { CudyrCategoryInput } from '@/domain/evaluationScales/importedCudyr';

const patients = (record: DailyRecord): PatientData[] =>
  Object.values(record.beds).flatMap(p => (p.clinicalCrib ? [p, p.clinicalCrib] : [p]));
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
    return patients(record).flatMap(patient => {
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

/** No name-only, bed, maternal-document or duplicate-episode attribution. Blank means unknown. */
export const recoverDailyCudyrGap = (
  gap: DailyCudyrGap,
  records: readonly DailyRecord[],
  source: CapturedCudyrMonthlyReport
): DocumentaryCudyr | null => {
  const { patient, sourceDate } = gap;
  if (
    records.some(
      record =>
        patients(record).filter(p => p.clinicalEpisodeId === patient.clinicalEpisodeId).length > 1
    )
  )
    return null;
  if (
    patient.clinicalEpisodeId !== gap.clinicalEpisodeId ||
    patient.documentType !== 'RUT' ||
    !isValidRut(patient.rut) ||
    !patient.patientName.trim() ||
    patient.neonatalMaternalRut ||
    patient.identityStatus === 'provisional' ||
    source.report.month !== sourceDate.slice(0, 7)
  )
    return null;
  const document = cudyrDocumentKey(patient.rut);
  const identity = cudyrIdentity(patient.rut, patient.patientName);
  if (
    !hasUniqueDocumentaryCudyrIdentity(
      records.filter(record => record.date === gap.date || record.date === sourceDate),
      patient
    )
  )
    return null;
  // A repeated documentary row may represent a readmission; do not pick the latest/first row.
  const rows = source.report.patients.filter(p => cudyrDocumentKey(p.document) === document);
  if (rows.length !== 1 || cudyrIdentity(rows[0].document, rows[0].patientName) !== identity)
    return null;
  const cells = rows[0].days.filter(d => d.sourceDate === sourceDate);
  const category = cells[0]?.category;
  if (
    !category ||
    cells.length !== 1 ||
    cells[0].state !== 'category' ||
    !/^[A-D][1-3]$/.test(category)
  )
    return null;
  return {
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
  };
};
