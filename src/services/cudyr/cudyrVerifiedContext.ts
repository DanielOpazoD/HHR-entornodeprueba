import { createCudyrRecoveredRow } from './cudyrRecoveredRow';
import { cudyrDocumentKey, cudyrIdentity, cudyrNameKey } from '@/domain/cudyr/cudyrSourceIdentity';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementDay, CudyrSupplementPatient } from '@/types/domain/cudyrSupplement';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { monthlySourceIsFinal } from './cudyrMonthlyProjection';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

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

type ReviewedTimingBasis = NonNullable<CudyrReportRow['verifiedContext']>['applicationTimingBasis'];

/** Rows, issues and final sources shared by every reviewed entry of one report pass. */
interface VerifiedContextPass {
  rows: CudyrReportRow[];
  issues: string[];
  sources: ArchivedCudyrSupplement[];
  now: Date;
}

const HOUR_MS = 3600000;
const VERIFIED_ADMISSION_SOURCE = 'Conciliación documental verificada · Eloísa / censo HHR';

/** Name key with only letters and digits, so a reviewed name matches its source spelling. */
const compactNameKey = (value: string) => cudyrNameKey(value).replace(/[^A-Z0-9]/g, '');

const byEpisodeDay = (rows: CudyrReportRow[], entry: CudyrVerifiedContextEntry) =>
  rows.filter(r => r.date === entry.date && r.clinicalEpisodeId === entry.clinicalEpisodeId);

/** CUD-03/CUD-04: why a reviewed context is not eligible; `fallback` when none of the exclusions apply. */
const reviewedExclusionReason = (
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
const reviewedStayIsValid = (entry: CudyrVerifiedContextEntry) => {
  const admission = Date.parse(entry.admissionAt);
  const discharge = Date.parse(entry.dischargeAt);
  return Number.isFinite(admission) && Number.isFinite(discharge) && discharge > admission;
};

const reviewedContext = (
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
const applyReviewedAbsence = (
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
