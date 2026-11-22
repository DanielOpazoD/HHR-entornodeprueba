import { createCudyrRecoveredRow } from './cudyrRecoveredRow';
import { cudyrDocumentKey, cudyrNameKey } from '@/domain/cudyr/cudyrSourceIdentity';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementPatient } from '@/types/domain/cudyrSupplement';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { monthlySourceIsFinal } from './cudyrMonthlyProjection';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import {
  byEpisodeDay,
  compactNameKey,
  HOUR_MS,
  reviewedContext,
  reviewedExclusionReason,
  reviewedStayIsValid,
  VERIFIED_ADMISSION_SOURCE,
  type CudyrVerifiedContext,
  type CudyrVerifiedContextEntry,
  type VerifiedContextPass,
} from './cudyrVerifiedContextShared';

/** CEN-02: a reviewed absence may recreate a missing census day from its documentary context. */
const seedReviewedAbsenceRow = (entry: CudyrVerifiedContextEntry) => {
  const target = createCudyrRecoveredRow(entry.date, entry.patientName!, entry.document);
  target.clinicalEpisodeId = entry.clinicalEpisodeId;
  const stamp = calendarStampInClinicalTimeZone(new Date(entry.admissionAt));
  const cutoff = cudyrReferenceInstant(entry.date);
  const hours = cutoff ? (Date.parse(cutoff) - Date.parse(entry.admissionAt)) / HOUR_MS : -1;
  target.admissionDate = stamp.iso;
  target.admissionTime = stamp.hhmm;
  target.hospitalAdmissionAt = entry.admissionAt;
  target.bedId = entry.bedId;
  target.bedName = entry.bedName;
  target.modality = entry.modality;
  target.group = entry.group;
  target.eligibility =
    entry.modality === 'hospitalizacion' && hours >= 8 ? 'elegible' : 'no_elegible';
  target.eligibilityReason = reviewedExclusionReason(
    entry.modality,
    hours,
    'Contexto censal documental.'
  );
  return target;
};

/** CUD-04: a seeded day keeps the fixed 01:00 cutoff; a discharge before it is not eligible. */
const completeSeededAbsenceRow = (
  target: CudyrReportRow,
  entry: CudyrVerifiedContextEntry,
  reference: string
) => {
  target.referenceAt = reference;
  target.contextSource = 'verified_documentary_context';
  target.hospitalStayAdmissionAt = entry.admissionAt;
  target.hospitalAdmissionSource = VERIFIED_ADMISSION_SOURCE;
  target.resolvedSystemDeparture = Date.parse(entry.dischargeAt) <= Date.parse(reference);
  if (target.resolvedSystemDeparture) {
    target.eligibility = 'no_elegible';
    target.eligibilityReason = 'Egreso confirmado antes del corte CUDYR.';
  }
};

/** ID-01: an absence binds only one row whose document and full name match a final report. */
const reviewedAbsenceIsCorroborated = (
  pass: VerifiedContextPass,
  entry: CudyrVerifiedContextEntry,
  archive: ArchivedCudyrSupplement,
  sourceDate: string,
  targets: CudyrReportRow[]
) => {
  const firstTarget = targets.length === 1 ? targets[0] : undefined;
  return (
    entry.sourceRow === null &&
    Boolean(entry.document) &&
    Boolean(entry.patientName) &&
    archive.report.month === sourceDate.slice(0, 7) &&
    monthlySourceIsFinal(archive, entry.date, pass.now) &&
    firstTarget !== undefined &&
    cudyrDocumentKey(firstTarget.rut) === cudyrDocumentKey(entry.document) &&
    compactNameKey(firstTarget.patientName) === compactNameKey(entry.patientName || '')
  );
};

/** ID-03: a cradle RN may cite its mother's source row, never as the same person. */
const isMaternalSourceRow = (
  entry: CudyrVerifiedContextEntry,
  mother: CudyrSupplementPatient | undefined
): mother is CudyrSupplementPatient =>
  entry.modality === 'cuna' &&
  mother !== undefined &&
  cudyrDocumentKey(mother.document) === cudyrDocumentKey(entry.document) &&
  !/^(RN|RECIEN NACIDO|RECIEN NACIDA)\b/.test(cudyrNameKey(mother.patientName)) &&
  compactNameKey(mother.patientName) !== compactNameKey(entry.patientName!);

/** ID-01: any final report row with this document or name (other than the bound mother) needs review. */
const hasCompetingReportIdentity = (
  pass: VerifiedContextPass,
  entry: CudyrVerifiedContextEntry,
  archive: ArchivedCudyrSupplement,
  boundMother: CudyrSupplementPatient | undefined
) =>
  pass.sources.some(
    source =>
      source.report.month === archive.report.month &&
      monthlySourceIsFinal(source, entry.date, pass.now) &&
      source.report.patients.some(
        p =>
          !(
            boundMother &&
            cudyrDocumentKey(p.document) === cudyrDocumentKey(boundMother.document) &&
            compactNameKey(p.patientName) === compactNameKey(boundMother.patientName)
          ) &&
          (cudyrDocumentKey(p.document) === cudyrDocumentKey(entry.document) ||
            compactNameKey(p.patientName) === compactNameKey(entry.patientName!))
      )
  );

/** CUD-07: a reviewed complete query without a result marks the episode/day «No registrado». */
export const applyReviewedAbsence = (
  pass: VerifiedContextPass,
  review: CudyrVerifiedContext,
  entry: CudyrVerifiedContextEntry,
  archive: ArchivedCudyrSupplement | undefined
) => {
  const sourceDate = getNextDay(entry.date);
  const targets = byEpisodeDay(pass.rows, entry);
  let target = targets[0];
  let seeded = false;
  if (!target && entry.patientName && entry.evidenceHashes.length) {
    target = seedReviewedAbsenceRow(entry);
    seeded = true;
    targets.push(target);
  }
  if (
    !archive ||
    !target ||
    !reviewedAbsenceIsCorroborated(pass, entry, archive, sourceDate, targets)
  ) {
    pass.issues.push(`Verificación ${entry.date}: falta corroborar identidad o informe completo.`);
    return;
  }
  // A subsequently recovered positive or identified source cell supersedes this absence.
  if (target.evaluation || target.monthlyEvidence) return;
  const mother = archive.report.patients.find(p => p.sourceRow === entry.maternalSourceRow);
  const boundMother = isMaternalSourceRow(entry, mother) ? mother : undefined;
  if (entry.maternalSourceRow !== undefined && !boundMother) {
    pass.issues.push(`Verificación ${entry.date}: vínculo materno inválido.`);
    return;
  }
  if (hasCompetingReportIdentity(pass, entry, archive, boundMother)) {
    pass.issues.push(
      `Verificación ${entry.date}: existe una identidad en el informe que requiere cotejo.`
    );
    return;
  }
  const reference = cudyrReferenceInstant(entry.date);
  if (!reference || !reviewedStayIsValid(entry)) {
    pass.issues.push(`Verificación ${entry.date}: intervalo hospitalario inválido.`);
    return;
  }
  if (seeded) {
    completeSeededAbsenceRow(target, entry, reference);
    pass.rows.push(target);
  }
  // Verification of a complete query only: preserve census, admission, bed and eligibility.
  target.cudyrStatus = 'sin_registro_observado';
  target.monthlyEvidence = {
    reportId: archive.id,
    sourceDate,
    checkedAt: archive.capture!.observedAt,
    state: 'absent',
  };
  target.verifiedContext = reviewedContext(review, entry, 'assumed_before_0800');
};
