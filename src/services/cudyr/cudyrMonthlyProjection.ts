import { CUDYR_ADMIN_ADJUSTMENT_SOURCE } from '@/domain/evaluationScales/importedCudyr';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import type {
  CudyrReportDataset,
  CudyrReportEvaluation,
  CudyrReportRow,
} from '@/types/domain/cudyrReport';
import type { CudyrSupplementDay, CudyrSupplementPatient } from '@/types/domain/cudyrSupplement';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';

const sourceDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const cudyrApplicationSourceDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return sourceDateFormatter.format(new Date(value));
};

export {
  cudyrDocumentKey,
  cudyrNameKey,
  cudyrFullNameKey,
} from '@/domain/cudyr/cudyrSourceIdentity';
import { cudyrDocumentKey } from '@/domain/cudyr/cudyrSourceIdentity';
import { createCudyrIdentityResolver, cudyrOrderedIdentity } from './cudyrNameReconciliation';
import { resolveRepeatedMonthlyEpisodes } from './cudyrMonthlyEpisodeLink';
export const isEloisaCudyr = (source: string) => /elo[ií]sa/i.test(source);
/** A justified administrative contingency: it stays authoritative over Eloísa's cell for its row. */
export const isAuthorizedCudyrAdminAdjustment = (
  evaluation: CudyrReportEvaluation | null
): boolean =>
  evaluation?.source === CUDYR_ADMIN_ADJUSTMENT_SOURCE &&
  Boolean(evaluation.adjustmentReason?.trim() && evaluation.adjustmentEvidence?.trim());
export const monthlySourceIsFinal = (r: ArchivedCudyrSupplement, day: string, now: Date) => {
  const times = [r.capture?.observedAt || '', r.importedAt];
  return (
    r.bytesVerified === true &&
    r.capture?.source === 'extension_monthly_report' &&
    times.every(
      t =>
        Number.isFinite(Date.parse(t)) &&
        Date.parse(t) <= now.getTime() &&
        resolveCudyrPendingStatus(day, new Date(t)).phase === 'overdue'
    )
  );
};

type CudyrIdentity = typeof cudyrOrderedIdentity;
type MonthlyEvidence = NonNullable<CudyrReportRow['monthlyEvidence']>;

/** Final, verified monthly reports and the rows they project onto, for one report pass. */
interface MonthlySourcePass {
  input: CudyrReportDataset;
  now: Date;
  rows: CudyrReportRow[];
  identity: CudyrIdentity;
  latest: Map<string, ArchivedCudyrSupplement>;
  positiveVersions: Map<string, string>;
  positiveCategories: Map<string, Set<string>>;
}

/** What one report row says about its patient's identity in this report and in the census. */
interface MonthlyPatientIdentity {
  id: string;
  duplicated: boolean;
  absenceAmbiguous: boolean;
}

/** One cell of one report row being projected, with what is known about that row's identity. */
interface MonthlyCell {
  archive: ArchivedCudyrSupplement;
  repeatedLinks: Map<number, string>;
  patient: CudyrSupplementPatient;
  who: MonthlyPatientIdentity;
  cell: CudyrSupplementDay;
}

const MONTHLY_REPORT_SOURCE = 'Eloísa · informe mensual';

/** CUD-01: an unreviewed legacy manual score stays in the census, never as official CUDYR. */
const dropUnreviewedLegacyScores = (rows: CudyrReportRow[]) => {
  for (const row of rows)
    if (
      row.evaluation &&
      !isEloisaCudyr(row.evaluation.source) &&
      !isAuthorizedCudyrAdminAdjustment(row.evaluation)
    ) {
      row.evaluation = null;
      row.evaluationCount = 0;
      row.evaluationCapturedAt = undefined;
      row.cudyrStatus = 'sin_captura';
      row.warnings.push(
        'Puntuación manual antigua conservada en el censo; no se utiliza como CUDYR oficial.'
      );
    }
};

const observedBy = (value: string, now: Date) =>
  Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();

/** The newest capture of a month wins; on the same capture time, the latest import. */
const isNewerMonthlyArchive = (
  archive: ArchivedCudyrSupplement,
  old: ArchivedCudyrSupplement | undefined
) =>
  !old ||
  Date.parse(archive.capture!.observedAt) > Date.parse(old.capture!.observedAt) ||
  (Date.parse(archive.capture!.observedAt) === Date.parse(old.capture!.observedAt) &&
    archive.importedAt > old.importedAt);

/** SRC-01: only byte-verified extension captures observed by now count, oldest first. */
const selectVerifiedArchives = (archives: ArchivedCudyrSupplement[], now: Date) => {
  const latest = new Map<string, ArchivedCudyrSupplement>();
  const verified: ArchivedCudyrSupplement[] = [];
  for (const a of archives) {
    if (a.capture?.source !== 'extension_monthly_report' || a.bytesVerified !== true) continue;
    if (!observedBy(a.capture.observedAt, now) || !observedBy(a.importedAt, now)) continue;
    verified.push(a);
    if (isNewerMonthlyArchive(a, latest.get(a.month))) latest.set(a.month, a);
  }
  verified.sort(
    (a, b) =>
      Date.parse(a.capture!.observedAt) - Date.parse(b.capture!.observedAt) ||
      a.importedAt.localeCompare(b.importedAt)
  );
  return { verified, latest };
};

const positiveCellKey = (
  identity: CudyrIdentity,
  patient: CudyrSupplementPatient,
  cell: CudyrSupplementDay
) => JSON.stringify([identity(patient.document, patient.patientName), cell.sourceDate]);

/** CUD-08: keep the newest positive per identity/day; a later empty snapshot cannot erase it. */
const collectPositiveCells = (
  verified: ArchivedCudyrSupplement[],
  identity: CudyrIdentity,
  now: Date
) => {
  const positiveVersions = new Map<string, string>();
  const positiveCategories = new Map<string, Set<string>>();
  for (const archive of verified)
    for (const patient of archive.report.patients)
      for (const cell of patient.days)
        if (
          cell.category &&
          monthlySourceIsFinal(archive, previousCensusIsoDay(cell.sourceDate), now)
        ) {
          const key = positiveCellKey(identity, patient, cell);
          positiveVersions.set(key, archive.id);
          const categories = positiveCategories.get(key) || new Set<string>();
          categories.add(cell.category);
          positiveCategories.set(key, categories);
        }
  return { positiveVersions, positiveCategories };
};

/** ID-01/ID-02: a report row needs one document holder, and an absence needs one known episode. */
const monthlyPatientIdentity = (
  pass: MonthlySourcePass,
  archive: ArchivedCudyrSupplement,
  patient: CudyrSupplementPatient
): MonthlyPatientIdentity => {
  const { identity, input } = pass;
  const id = identity(patient.document, patient.patientName);
  const duplicated =
    !patient.document ||
    archive.report.patients.filter(p => identity(p.document, p.patientName) === id).length !== 1;
  const own = input.rows.filter(r => identity(r.rut, r.patientName) === id);
  const episodes = new Set(own.map(r => r.clinicalEpisodeId).filter(Boolean));
  const absenceAmbiguous =
    episodes.size !== 1 ||
    own.some(r => !r.clinicalEpisodeId) ||
    input.rows.some(
      r =>
        cudyrDocumentKey(r.rut) === cudyrDocumentKey(patient.document) &&
        identity(r.rut, r.patientName) !== id
    );
  return { id, duplicated, absenceAmbiguous };
};

/** A positive cell counts from its newest positive report; a blank only from the month's latest. */
const isCurrentMonthlyCell = (pass: MonthlySourcePass, { archive, patient, cell }: MonthlyCell) =>
  cell.category
    ? pass.positiveVersions.get(positiveCellKey(pass.identity, patient, cell)) === archive.id
    : pass.latest.get(archive.month)?.id === archive.id;

/** CUD-06/CUD-10: one original application time wins over the date-only night-shift rule. */
const monthlyCellDay = (pass: MonthlySourcePass, id: string, cell: CudyrSupplementDay) => {
  const matching = pass.rows.filter(
    r =>
      pass.identity(r.rut, r.patientName) === id &&
      cudyrApplicationSourceDate(r.evaluation?.recordedAt) === cell.sourceDate
  );
  const date = matching.length === 1 ? matching[0].date : previousCensusIsoDay(cell.sourceDate);
  return { matching, date };
};

/** A blank in another stay is not contrary evidence to this day's proven positive owner. */
const blankBelongsToOtherStay = (
  { archive, repeatedLinks, cell }: MonthlyCell,
  candidates: CudyrReportRow[]
) =>
  candidates.length === 1 &&
  archive.report.patients.some(
    other =>
      repeatedLinks.get(other.sourceRow) === candidates[0].clinicalEpisodeId &&
      other.days.some(day => day.sourceDate === cell.sourceDate && day.category)
  );

/** ID-02: a repeated report identity resolves only through its own episode timeline. */
const isResolvedRepeat = (
  { repeatedLinks, patient, cell }: MonthlyCell,
  candidates: CudyrReportRow[]
) => {
  const linkedEpisode = cell.category ? repeatedLinks.get(patient.sourceRow) : undefined;
  return Boolean(
    linkedEpisode && candidates.length === 1 && candidates[0].clinicalEpisodeId === linkedEpisode
  );
};

/** CUD-10: a row whose recorded application belongs to another source day keeps its own evidence. */
const keepsOtherDayApplication = (
  row: CudyrReportRow | undefined,
  cell: CudyrSupplementDay,
  matching: CudyrReportRow[]
) =>
  Boolean(
    row?.monthlyEvidence &&
    row.evaluation?.recordedAt &&
    row.monthlyEvidence.sourceDate !== cell.sourceDate &&
    !matching.length
  );

/** CUD-08: a positive cell with no census row is kept, without inventing bed or eligibility. */
const monthlyRecoveredRow = (
  { archive, patient, cell }: MonthlyCell,
  date: string,
  ambiguous: boolean
): CudyrReportRow => ({
  key: `monthly:${archive.id}:${patient.sourceRow}:${date}`,
  date,
  clinicalEpisodeId: '',
  authorityDate: date,
  patientName: patient.patientName,
  firstName: '',
  lastName: '',
  secondLastName: '',
  rut: patient.document,
  documentType: '',
  diagnosis: patient.diagnosis,
  diagnosisCode: '',
  identitySource: MONTHLY_REPORT_SOURCE,
  identitySourceDate: cell.sourceDate,
  admissionDate: '',
  admissionTime: '',
  bedId: '',
  bedName: '',
  service: patient.service,
  specialty: '',
  group: 'sin_grupo',
  modality: 'desconocida',
  eligibility: 'por_revisar',
  eligibilityReason:
    'Paciente recuperado de Eloísa: falta su contexto censal y de cama de este día.',
  contextSource: 'eloisa_monthly_report',
  referenceAt: '',
  cudyrStatus: 'registrado',
  evaluation: null,
  evaluationCount: 0,
  lastCaptureAt: '',
  lastPersistedAt: '',
  captureActor: '',
  captureId: '',
  sourceRunId: '',
  dailyCudyrSavedAt: '',
  dailyCudyrSavedBy: '',
  medicalEpicrisisStatus: '',
  nursingEpicrisisStatus: '',
  epicrisisRegisteredAt: '',
  movements: [],
  warnings: [
    ambiguous
      ? 'Categoría oficial sin asociación clínica: identidad o turno ambiguo.'
      : 'Falta en el censo HHR de este día. No se presume cama ni elegibilidad.',
  ],
  applicationPending: false,
});

/**
 * ID-01/CUD-06: the census row a monthly cell belongs to, or none when the cell does not apply.
 * Ambiguous identities or shifts are flagged; a positive cell is then kept on a row of its own.
 */
const locateMonthlyCellRow = (pass: MonthlySourcePass, at: MonthlyCell) => {
  const { archive, who, cell } = at;
  const { matching, date } = monthlyCellDay(pass, who.id, cell);
  const { from, to } = pass.input;
  if (date < from || date > to || !monthlySourceIsFinal(archive, date, pass.now)) return undefined;
  const candidates = pass.rows.filter(
    r => r.date === date && pass.identity(r.rut, r.patientName) === who.id
  );
  if (!cell.category && who.duplicated && blankBelongsToOtherStay(at, candidates)) return undefined;
  const resolvedRepeat = isResolvedRepeat(at, candidates);
  const ambiguous =
    (who.duplicated && !resolvedRepeat) ||
    candidates.length > 1 ||
    matching.length > 1 ||
    (!cell.category && who.absenceAmbiguous);
  if (ambiguous) {
    for (const r of candidates)
      r.warnings.push('Informe mensual: identidad o turno ambiguo; requiere cotejo.');
    if (!cell.category) return undefined;
  }
  let row = ambiguous ? undefined : candidates[0];
  if (keepsOtherDayApplication(row, cell, matching)) return undefined;
  if (!row && !cell.category) return undefined;
  if (!row) {
    row = monthlyRecoveredRow(at, date, ambiguous);
    pass.rows.push(row);
  }
  return { row, resolvedRepeat };
};

/** SRC-02: where the cell came from, and how its report identity was matched to the census. */
const monthlyCellEvidence = (
  { archive, patient, cell }: MonthlyCell,
  row: CudyrReportRow,
  resolvedRepeat: boolean
): MonthlyEvidence => ({
  reportId: archive.id,
  sourceDate: cell.sourceDate,
  checkedAt: archive.capture!.observedAt,
  state: cell.category ? 'found' : 'absent',
  sourceRow: patient.sourceRow,
  ...(resolvedRepeat ? { linkMethod: 'episode_timeline' as const } : {}),
  ...(cudyrOrderedIdentity(row.rut, row.patientName) !==
  cudyrOrderedIdentity(patient.document, patient.patientName)
    ? {
        identityMatch: 'census_name_normalization' as const,
        sourcePatientName: patient.patientName,
      }
    : {}),
});

/** CUD-01: a reviewed contingency remains authoritative; source evidence stays visible separately. */
const keepAuthorizedAdjustment = (row: CudyrReportRow, cell: CudyrSupplementDay) => {
  if (cell.category && cell.category !== row.evaluation?.category) {
    const warning =
      'Eloísa difiere del ajuste administrativo; se conserva la excepción autorizada.';
    if (!row.warnings.includes(warning)) row.warnings.push(warning);
  }
  row.cudyrStatus = 'registrado';
};

/** CUD-08/CUD-11: the final report category; differing final reports leave the day for review. */
const applyMonthlyCategory = (
  pass: MonthlySourcePass,
  { archive, patient, cell }: MonthlyCell,
  category: string,
  row: CudyrReportRow,
  evidence: MonthlyEvidence
) => {
  if ((pass.positiveCategories.get(positiveCellKey(pass.identity, patient, cell))?.size || 0) > 1) {
    evidence.state = 'conflict';
    row.warnings.push(
      'Los informes finales de Eloísa contienen categorías diferentes para este día; se muestra la más reciente y requiere cotejo.'
    );
  }
  const prior = row.evaluation;
  // Keep richer metadata only when it describes the same category/application date.
  const compatible =
    prior?.category === category &&
    (!prior.recordedAt || cudyrApplicationSourceDate(prior.recordedAt) === cell.sourceDate);
  if (prior && !compatible)
    row.warnings.push(
      `Categoría actualizada desde el informe final de Eloísa (${prior.category} → ${category}).`
    );
  row.evaluation = compatible
    ? prior
    : {
        category,
        source: MONTHLY_REPORT_SOURCE,
        recordedAt: '',
        sourceEvaluationId: '',
        author: '',
        authorId: '',
        authorRole: '',
        metadataWarning: 'Informe mensual: autor y hora no informados.',
      };
  row.cudyrStatus = evidence.state === 'conflict' ? 'por_revisar' : 'registrado';
  row.evaluationCount = Math.max(row.evaluationCount, 1);
  row.evaluationCapturedAt = archive.capture!.observedAt;
};

/** CUD-07/CUD-08: record one monthly cell on its row: found, contradicted, or not registered. */
const recordMonthlyCell = (
  pass: MonthlySourcePass,
  at: MonthlyCell,
  row: CudyrReportRow,
  resolvedRepeat: boolean
) => {
  const { archive, cell } = at;
  if (cell.category && pass.latest.get(archive.month)?.id !== archive.id)
    row.warnings.push(
      'Resultado oficial conservado de un informe anterior; la versión posterior no aporta categoría para esta identidad y día.'
    );
  const evidence = monthlyCellEvidence(at, row, resolvedRepeat);
  row.monthlyEvidence = evidence;
  if (isAuthorizedCudyrAdminAdjustment(row.evaluation)) keepAuthorizedAdjustment(row, cell);
  else if (cell.category) applyMonthlyCategory(pass, at, cell.category, row, evidence);
  else if (row.evaluation) {
    // A positive original Eloísa application is still evidence; flag contradictory source cells.
    evidence.state = 'conflict';
    row.warnings.push(
      'El informe mensual no muestra la aplicación de Eloísa ya guardada; requiere cotejo.'
    );
  } else row.cudyrStatus = 'sin_registro_observado';
};

/** Rebuildable official-source projection: no invented author, time, bed, or clinical episode. */
export const applyCudyrMonthlySources = (
  input: CudyrReportDataset,
  archives: ArchivedCudyrSupplement[]
): CudyrReportDataset => {
  const now = new Date(input.generatedAt);
  const rows = input.rows.map(r => ({ ...r, warnings: [...r.warnings] }));
  // Eloísa results and justified administrative exceptions contribute. Unreviewed legacy scores do not.
  dropUnreviewedLegacyScores(rows);
  const { verified, latest } = selectVerifiedArchives(archives, now);
  const identity = createCudyrIdentityResolver(
    input,
    verified.map(a => a.report)
  );
  const pass: MonthlySourcePass = {
    input,
    now,
    rows,
    identity,
    latest,
    ...collectPositiveCells(verified, identity, now),
  };
  for (const archive of verified) {
    const repeatedLinks = resolveRepeatedMonthlyEpisodes(input, archive.report, identity);
    for (const patient of archive.report.patients) {
      const who = monthlyPatientIdentity(pass, archive, patient);
      for (const cell of patient.days) {
        const at: MonthlyCell = { archive, repeatedLinks, patient, who, cell };
        if (!isCurrentMonthlyCell(pass, at)) continue;
        const located = locateMonthlyCellRow(pass, at);
        if (located) recordMonthlyCell(pass, at, located.row, located.resolvedRepeat);
      }
    }
  }
  return {
    ...input,
    rows: rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.bedId.localeCompare(b.bedId) || a.key.localeCompare(b.key)
    ),
  };
};
