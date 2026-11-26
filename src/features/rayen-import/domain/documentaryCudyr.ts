import { cudyrDocumentKey, cudyrIdentity } from '@/domain/cudyr/cudyrSourceIdentity';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import { isValidRut } from '@/utils/rutUtils';
import { getNextDay } from '@/utils/clinicalDayUtils';

export const CUDYR_DOCUMENTARY_SOURCE = 'Eloísa · informe mensual';
export type DocumentaryCudyr = ImportedCudyr & {
  source: typeof CUDYR_DOCUMENTARY_SOURCE;
  documentaryEvidence: NonNullable<ImportedCudyr['documentaryEvidence']>;
};

export const hasAcceptedCudyr = (patient: PatientData): boolean =>
  Boolean(patient.evaluationScores?.cudyr || patient.cudyr);

export const isProtectedCudyrDay = (record: DailyRecord): boolean =>
  Boolean(
    record.cudyrLocked ||
    record.cudyrCompletedAt ||
    record.medicalSignature ||
    Object.values(record.medicalSignatureByScope ?? {}).some(Boolean)
  );

/** Include sparse movement rows and both people in an undo snapshot. */
const isoDay = (value?: string): string => {
  const day = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
};
const isoStamp = (date?: string, time?: string): string => {
  const day = isoDay(date);
  return day && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time ?? '')) ? `${day}T${time}` : '';
};

/**
 * A same-document episode outside the evaluated night is a readmission, not an ambiguity: it began
 * after that census day, or it ended before this episode began. Missing or malformed dates stay ambiguous.
 */
const isOutsideEvaluatedNight = (
  entry: object,
  patient: PatientData,
  censusDay: string
): boolean => {
  const candidate = entry as { admissionDate?: string; movementDate?: string; time?: string };
  const admitted = isoDay(candidate.admissionDate);
  if (admitted && admitted > censusDay) return true;
  const ended = isoStamp(candidate.movementDate, candidate.time);
  const began = isoStamp(patient.admissionDate, patient.admissionTime);
  return Boolean(ended && began && ended < began);
};

const movementStamp = (movement: object) => {
  const { movementDate, time } = movement as { movementDate?: string; time?: string };
  return { movementDate, time };
};

export const hasUniqueDocumentaryCudyrIdentity = (
  records: readonly DailyRecord[],
  patient: PatientData,
  censusDay?: string
): boolean => {
  const candidates = records.flatMap(record => [
    ...Object.values(record.beds).flatMap(p => (p.clinicalCrib ? [p, p.clinicalCrib] : [p])),
    ...[...(record.discharges ?? []), ...(record.transfers ?? []), ...(record.cma ?? [])].flatMap(
      m =>
        m.deletedAt
          ? []
          : [
              {
                ...m,
                clinicalEpisodeId: m.clinicalEpisodeId || m.originalData?.clinicalEpisodeId,
              },
              ...(m.originalData
                ? [
                    m.originalData,
                    ...(m.originalData.clinicalCrib ? [m.originalData.clinicalCrib] : []),
                  ].map(p => ({ ...p, ...movementStamp(m) }))
                : []),
            ]
    ),
  ]);
  const sameDocument = candidates.filter(
    c => cudyrDocumentKey(c.rut) === cudyrDocumentKey(patient.rut)
  );
  const outside = new Set(
    censusDay
      ? sameDocument.filter(
          c =>
            c.clinicalEpisodeId !== patient.clinicalEpisodeId &&
            isOutsideEvaluatedNight(c, patient, censusDay)
        )
      : []
  );
  return (
    sameDocument.length > 0 &&
    sameDocument.every(
      c =>
        outside.has(c) ||
        ((!('documentType' in c) || c.documentType !== 'Pasaporte') &&
          (!('neonatalMaternalRut' in c) || !c.neonatalMaternalRut) &&
          c.clinicalEpisodeId === patient.clinicalEpisodeId &&
          cudyrIdentity(c.rut, c.patientName) === cudyrIdentity(patient.rut, patient.patientName))
    )
  );
};

/** Rechecked at every write/rebuild; older callers cannot turn documentary evidence into replace. */
export const assertDocumentaryCudyrTarget = (
  record: DailyRecord,
  patient: PatientData,
  cudyr: ImportedCudyr
): void => {
  if (cudyr.source !== CUDYR_DOCUMENTARY_SOURCE && !cudyr.documentaryEvidence) return;
  const evidence = cudyr.documentaryEvidence;
  const episodeMatches = Object.values(record.beds)
    .flatMap(p => [p, p.clinicalCrib])
    .filter(p => p?.clinicalEpisodeId === patient.clinicalEpisodeId);
  if (
    cudyr.source !== CUDYR_DOCUMENTARY_SOURCE ||
    !evidence ||
    !evidence.reportId ||
    episodeMatches.length !== 1 ||
    !hasUniqueDocumentaryCudyrIdentity([record], patient, record.date) ||
    !Number.isInteger(evidence.sourceRow) ||
    evidence.sourceDate !== getNextDay(record.date) ||
    cudyr.recordedDate !== record.date ||
    cudyr.recordedAt ||
    cudyr.author ||
    cudyr.history ||
    cudyr.items ||
    !/^[A-D][1-3]$/.test(cudyr.category) ||
    !isValidRut(patient.rut) ||
    patient.documentType !== 'RUT' ||
    evidence.documentType !== 'RUT' ||
    patient.neonatalMaternalRut ||
    patient.identityStatus === 'provisional' ||
    evidence.clinicalEpisodeId !== patient.clinicalEpisodeId ||
    cudyrIdentity(evidence.document, evidence.patientName) !==
      cudyrIdentity(patient.rut, patient.patientName)
  )
    throw new Error('La evidencia mensual no identifica inequívocamente este episodio y turno.');
  if (isProtectedCudyrDay(record)) throw new Error('El censo CUDYR está protegido.');
};
