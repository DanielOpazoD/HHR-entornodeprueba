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
export const hasUniqueDocumentaryCudyrIdentity = (
  records: readonly DailyRecord[],
  patient: PatientData
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
                  ]
                : []),
            ]
    ),
  ]);
  const sameDocument = candidates.filter(
    c => cudyrDocumentKey(c.rut) === cudyrDocumentKey(patient.rut)
  );
  return (
    sameDocument.length > 0 &&
    sameDocument.every(
      c =>
        (!('documentType' in c) || c.documentType !== 'Pasaporte') &&
        (!('neonatalMaternalRut' in c) || !c.neonatalMaternalRut) &&
        c.clinicalEpisodeId === patient.clinicalEpisodeId &&
        cudyrIdentity(c.rut, c.patientName) === cudyrIdentity(patient.rut, patient.patientName)
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
    !hasUniqueDocumentaryCudyrIdentity([record], patient) ||
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
