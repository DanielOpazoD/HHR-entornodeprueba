import { createCudyrRecoveredRow } from './cudyrRecoveredRow';
import { cudyrIdentity } from '@/domain/cudyr/cudyrSourceIdentity';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementDay, CudyrSupplementPatient } from '@/types/domain/cudyrSupplement';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { monthlySourceIsFinal } from './cudyrMonthlyProjection';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import {
  byEpisodeDay,
  HOUR_MS,
  reviewedContext,
  reviewedExclusionReason,
  reviewedStayIsValid,
  VERIFIED_ADMISSION_SOURCE,
  type CudyrVerifiedContext,
  type CudyrVerifiedContextEntry,
  type VerifiedContextPass,
} from './cudyrVerifiedContextShared';
import { applyReviewedAbsence } from './cudyrVerifiedContextAbsence';

export type { CudyrVerifiedContext, CudyrVerifiedContextEntry } from './cudyrVerifiedContextShared';

/**
 * Rows already holding this source cell. A later download may have a new archive ID / row order:
 * reuse reviewed identity only for one exact document + full-name source row, never fuzzy names
 * or a shared RN RUT.
 */
const rowsHoldingSourceCell = (
  pass: VerifiedContextPass,
  entry: CudyrVerifiedContextEntry,
  patient: CudyrSupplementPatient,
  cell: CudyrSupplementDay
) =>
  pass.rows.filter(r => {
    if (r.date !== entry.date || !r.monthlyEvidence) return false;
    if (
      r.monthlyEvidence.reportId === entry.reportId &&
      r.monthlyEvidence.sourceRow === entry.sourceRow
    )
      return true;
    const newer = pass.sources.find(s => s.id === r.monthlyEvidence!.reportId);
    if (!newer || !monthlySourceIsFinal(newer, entry.date, pass.now)) return false;
    const candidates = newer.report.patients.filter(
      p =>
        cudyrIdentity(p.document, p.patientName) ===
        cudyrIdentity(patient.document, patient.patientName)
    );
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    return (
      candidate !== undefined &&
      candidate.sourceRow === r.monthlyEvidence.sourceRow &&
      r.monthlyEvidence.sourceDate === cell.sourceDate
    );
  });

/** CUD-11: a category that differs from any existing evaluation of this cell stays for review. */
const sourceCellConflicts = (
  cell: CudyrSupplementDay,
  sourceRows: CudyrReportRow[],
  target: CudyrReportRow
) =>
  cell.state === 'uncategorized' ||
  sourceRows.some(
    r =>
      r.monthlyEvidence?.state === 'conflict' ||
      (r.evaluation && r.evaluation.category !== cell.category)
  ) ||
  (target.evaluation && (!cell.category || target.evaluation.category !== cell.category));

/** CUD-03/CUD-04: eligibility of a reviewed stay; a manual exclusion or resolved departure stays. */
const reviewedEligibility = (
  entry: CudyrVerifiedContextEntry,
  target: CudyrReportRow,
  cutoff: string
): Pick<CudyrReportRow, 'eligibility' | 'eligibilityReason'> => {
  const admission = Date.parse(entry.admissionAt);
  const hours = (Date.parse(cutoff) - admission) / HOUR_MS;
  if (
    target.exclusion?.reason ||
    target.correction?.actualDischarge ||
    target.resolvedSystemDeparture === true
  )
    return { eligibility: target.eligibility, eligibilityReason: target.eligibilityReason };
  const eligible =
    entry.modality === 'hospitalizacion' &&
    entry.group !== 'sin_grupo' &&
    hours >= 8 &&
    Date.parse(entry.dischargeAt) > Date.parse(cutoff);
  return eligible
    ? {
        eligibility: 'elegible',
        eligibilityReason:
          'Cumple ocho horas de hospitalización al corte de 01:00 del día siguiente.',
      }
    : {
        eligibility: 'no_elegible',
        eligibilityReason: reviewedExclusionReason(
          entry.modality,
          hours,
          'Egreso confirmado antes del corte CUDYR.'
        ),
      };
};

/** Metadata completeness of an evaluation: recorded time, author, source ID, then items. */
const evaluationRichness = (r: CudyrReportRow) =>
  r.evaluation
    ? Number(Boolean(r.evaluation.recordedAt)) * 8 +
      Number(Boolean(r.evaluation.author)) * 4 +
      Number(Boolean(r.evaluation.sourceEvaluationId)) * 2 +
      Number(Boolean(r.evaluation.items?.length))
    : -1;

/** CUD-06/CUD-08: the monthly-report category, without inventing an author or a time. */
const monthlyReportEvaluation = (category: string): CudyrReportRow['evaluation'] => ({
  category,
  source: 'Eloísa · informe mensual',
  recordedAt: '',
  sourceEvaluationId: '',
  author: '',
  authorId: '',
  authorRole: '',
  metadataWarning:
    'Informe histórico sin autor ni hora; madrugada anterior a las 08:00 asumida para asociar el turno.',
});

/** ID-02: never consume a cell already assigned to another episode or two existing targets. */
const contradictsEpisode = (
  entry: CudyrVerifiedContextEntry,
  targets: CudyrReportRow[],
  sourceRows: CudyrReportRow[]
) =>
  targets.length > 1 ||
  sourceRows.some(r => r.clinicalEpisodeId && r.clinicalEpisodeId !== entry.clinicalEpisodeId);

/** CUD-11: keep the richest existing evaluation of the same category, else the report category. */
const reviewedCellEvaluation = (mergedRows: CudyrReportRow[], cell: CudyrSupplementDay) => {
  const evaluationOwner = mergedRows
    .filter(r => r.evaluation?.category === cell.category)
    .sort((a, b) => evaluationRichness(b) - evaluationRichness(a))[0];
  const evaluation =
    evaluationOwner?.evaluation || (cell.category ? monthlyReportEvaluation(cell.category) : null);
  return { evaluationOwner, evaluation };
};

/** CUD-08: bind one reviewed monthly-report cell to its episode/day, merging the rows that held it. */
const applyReviewedSourceCell = (
  pass: VerifiedContextPass,
  review: CudyrVerifiedContext,
  entry: CudyrVerifiedContextEntry,
  archive: ArchivedCudyrSupplement | undefined
) => {
  const patient = archive?.report.patients.find(p => p.sourceRow === entry.sourceRow);
  const cell = patient?.days.find(d => d.sourceDate === getNextDay(entry.date));
  if (!archive || !patient || !cell || !monthlySourceIsFinal(archive, entry.date, pass.now)) {
    pass.issues.push(`Conciliación ${entry.date}: falta verificar el informe de origen.`);
    return;
  }
  const sourceRows = rowsHoldingSourceCell(pass, entry, patient, cell);
  const targets = byEpisodeDay(pass.rows, entry);
  if (contradictsEpisode(entry, targets, sourceRows)) {
    pass.issues.push(`Conciliación ${entry.date}: vínculo de episodio contradictorio.`);
    return;
  }
  const target =
    targets[0] ||
    sourceRows[0] ||
    createCudyrRecoveredRow(entry.date, patient.patientName, patient.document);
  if (sourceCellConflicts(cell, sourceRows, target)) {
    pass.issues.push(
      `Conciliación ${entry.date}: el CUDYR difiere del informe; se conserva para revisión.`
    );
    return;
  }
  const cutoff = cudyrReferenceInstant(entry.date);
  if (!cutoff || !reviewedStayIsValid(entry)) return;
  const stamp = calendarStampInClinicalTimeZone(new Date(entry.admissionAt));
  const mergedRows = [target, ...sourceRows];
  const { evaluationOwner, evaluation } = reviewedCellEvaluation(mergedRows, cell);
  const row: CudyrReportRow = {
    ...target,
    clinicalEpisodeId: entry.clinicalEpisodeId,
    key: targets[0]?.key || `${entry.date}:verified:${entry.clinicalEpisodeId}`,
    rut: entry.document || target.rut,
    documentType: entry.documentType || target.documentType,
    admissionDate: stamp.iso,
    admissionTime: stamp.hhmm,
    hospitalAdmissionAt: entry.admissionAt,
    hospitalStayAdmissionAt: entry.admissionAt,
    hospitalAdmissionSource: VERIFIED_ADMISSION_SOURCE,
    admissionEvidenceConflict: false,
    bedId: entry.bedId || target.bedId,
    bedName: entry.bedName || target.bedName || 'Hospitalizados · código no informado',
    service: target.service || 'Servicio Hospitalizados HHR',
    group: entry.group,
    modality: entry.modality,
    contextSource: 'verified_documentary_context',
    ...reviewedEligibility(entry, target, cutoff),
    referenceAt: cutoff,
    evaluation,
    evaluationCount: evaluation ? Math.max(1, ...mergedRows.map(r => r.evaluationCount)) : 0,
    evaluationCapturedAt: evaluationOwner?.evaluationCapturedAt || target.evaluationCapturedAt,
    cudyrStatus: evaluation ? 'registrado' : 'sin_registro_observado',
    monthlyEvidence: {
      reportId: archive.id,
      sourceDate: cell.sourceDate,
      sourceRow: entry.sourceRow ?? undefined,
      checkedAt: archive.capture!.observedAt,
      state: cell.category ? 'found' : 'absent',
    },
    verifiedContext: reviewedContext(
      review,
      entry,
      evaluation?.recordedAt ? 'recorded_time' : 'assumed_before_0800'
    ),
    warnings: target.warnings.filter(
      w => !w.includes('falta su contexto censal') && !w.includes('sin asociación')
    ),
  };
  const consumed = new Set([target.key, ...sourceRows.map(r => r.key)]);
  pass.rows = pass.rows.filter(r => !consumed.has(r.key));
  pass.rows.push(row);
};

/** CEN-02: a reviewed reconstruction makes its census day available. */
const markReconstructedDays = (
  coverage: CudyrReportDataset['coverage'],
  reviews: CudyrVerifiedContext[]
) =>
  coverage.map(day => {
    const reconstructed = reviews
      .flatMap(r =>
        r.verification === 'reviewed_documentary_context' ? r.reconstructedDays || [] : []
      )
      .find(d => d.date === day.date);
    return reconstructed
      ? { ...day, state: 'disponible' as const, documentaryReconstruction: reconstructed }
      : day;
  });

/** Bind reviewed episode/day context to immutable Eloísa cells. Never accepts a manual score. */
export const applyCudyrVerifiedContexts = (
  input: CudyrReportDataset,
  sources: ArchivedCudyrSupplement[],
  reviews: CudyrVerifiedContext[]
): CudyrReportDataset => {
  const pass: VerifiedContextPass = {
    rows: input.rows.map(r => ({ ...r, warnings: [...r.warnings] })),
    issues: [...input.issues],
    sources,
    now: new Date(input.generatedAt),
  };
  for (const review of reviews) {
    if (review.verification !== 'reviewed_documentary_context') continue;
    for (const entry of review.entries) {
      if (entry.date < input.from || entry.date > input.to) continue;
      const archive = sources.find(s => s.id === entry.reportId);
      if (entry.basis === 'reviewed_report_absence')
        applyReviewedAbsence(pass, review, entry, archive);
      else applyReviewedSourceCell(pass, review, entry, archive);
    }
  }
  pass.rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.bedId.localeCompare(b.bedId) ||
      a.patientName.localeCompare(b.patientName)
  );
  return {
    ...input,
    rows: pass.rows,
    issues: pass.issues,
    coverage: markReconstructedDays(input.coverage, reviews),
  };
};
