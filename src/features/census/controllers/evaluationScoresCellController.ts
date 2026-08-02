/**
 * View-model for the census "Scores" column (nursing risk scales). Pure and testable: given the
 * patient and the census day it derives what the cell and detail modal display. Eloísa owns the
 * visible risk classification; HHR's local rules continue to own planned care and reapplication
 * cadence ("faltan X días" → "Reaplicar hoy" → "Vencida hace X días").
 */

import {
  assessBraden,
  bradenReapplicationStatus,
  type BradenAssessment,
  type ReapplicationStatus,
  type ReapplicationUrgency,
} from '@/domain/evaluationScales/bradenRisk';
import type {
  BradenRiskLevel,
  EvaluationScaleApplicationEvidence,
  EvaluationScoreEntry,
  ImportedCudyr,
  PatientEvaluationScores,
} from '@/types/domain/evaluationScores';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';
import {
  parseSourceRiskLevel,
  sourceRiskLabel,
} from '@/domain/evaluationScales/sourceRiskSeverity';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';

export interface BradenCellModel {
  entry: EvaluationScoreEntry;
  application: EvaluationScaleApplicationEvidence;
  total: number;
  /** Eloísa classification used only for the visible label and color. */
  displayLevel: BradenRiskLevel | null;
  severityLabel: string;
  /** Local HHR assessment used only for care planning and reapplication cadence. */
  assessment: BradenAssessment;
  /** Short in-cell countdown chip, e.g. "5d" | "hoy" | "-2d". */
  chipCountdown: string;
  /** Full countdown sentence for the detail view, e.g. "Faltan 5 días para repetir la escala". */
  countdownLabel: string;
}

export interface DowntonCellModel {
  entry: EvaluationScoreEntry;
  application: EvaluationScaleApplicationEvidence;
  total: number;
  /** Eloísa classification used only for the visible label and color. */
  displayLevel: BradenRiskLevel | null;
  severityLabel: string;
  /** Reapplication follows the same cadence as Braden (bajo 7d · medio 3d · alto diario). */
  reapplication: ReapplicationStatus | null;
  chipCountdown: string | null;
  countdownLabel: string | null;
}

/** CUDYR (CRD) result imported from the official Gestión de Camas work list. */
export interface CudyrCellModel {
  entry: ImportedCudyr;
  category: string;
  /** First letter of the category (A/B/C/D) — drives the chip color. Null if not A–D. */
  band: 'A' | 'B' | 'C' | 'D' | null;
}

export interface ScoresCellModel {
  hasAny: boolean;
  braden: BradenCellModel | null;
  downton: DowntonCellModel | null;
  cudyr: CudyrCellModel | null;
  /** Highest urgency across scales — drives the cell-level visual alert. */
  alertUrgency: ReapplicationUrgency;
  /** Unified stay history (most-recent-first) for the detail modal's risk timeline. */
  history: EvaluationScoreEntry[];
}

/** Age in years at `referenceDate`: birthDate when available, else the stored age string. */
export const resolveAgeYears = (patient: PatientData, referenceDate: string): number | null => {
  if (patient.birthDate) {
    const born = new Date(`${patient.birthDate.split('T')[0]}T12:00:00`);
    const ref = new Date(`${referenceDate}T12:00:00`);
    if (!Number.isNaN(born.getTime()) && !Number.isNaN(ref.getTime())) {
      let years = ref.getFullYear() - born.getFullYear();
      const monthDelta = ref.getMonth() - born.getMonth();
      if (monthDelta < 0 || (monthDelta === 0 && ref.getDate() < born.getDate())) years -= 1;
      if (years >= 0) return years;
    }
  }
  const match = (patient.age ?? '').trim().match(/^(\d{1,3})/);
  return match ? Number(match[1]) : null;
};

const plural = (n: number, singular: string, pluralForm: string): string =>
  `${n} ${n === 1 ? singular : pluralForm}`;

const buildCountdownLabel = (daysUntilDue: number, urgency: ReapplicationUrgency): string => {
  if (urgency === 'due') return 'Reaplicar hoy';
  if (urgency === 'overdue')
    return `Vencida hace ${plural(Math.abs(daysUntilDue), 'día', 'días')} — reaplicar`;
  return `${daysUntilDue === 1 ? 'Falta' : 'Faltan'} ${plural(daysUntilDue, 'día', 'días')} para repetir la escala`;
};

const buildChipCountdown = (daysUntilDue: number, urgency: ReapplicationUrgency): string => {
  if (urgency === 'due') return 'hoy';
  if (urgency === 'overdue') return `${daysUntilDue}d`; // negative, e.g. "-2d"
  return `${daysUntilDue}d`;
};

/** Preserve the existing Downton reapplication behavior independently from presentation. */
const parseDowntonCadenceLevel = (severity: string | null): BradenRiskLevel | null => {
  const value = (severity ?? '').toLowerCase();
  if (value.includes('alto')) return 'alto';
  if (value.includes('medio') || value.includes('moderado')) return 'medio';
  if (value.includes('bajo')) return 'bajo';
  return null;
};

const applicationEvidence = (entry: EvaluationScoreEntry): EvaluationScaleApplicationEvidence =>
  entry.latestApplication ?? {
    recordedDate: entry.recordedDate,
    recordedAt: entry.recordedAt,
    ...(entry.author ? { author: entry.author } : {}),
    ...(entry.authorRole ? { authorRole: entry.authorRole } : {}),
    ...(entry.archived ? { archived: true } : {}),
  };

const clockParts = (
  value: string
): { minute: string; seconds: number; hasSeconds: boolean } | null => {
  const match = value.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return {
    minute: `${String(hour).padStart(2, '0')}:${match[2]}`,
    seconds: hour * 3600 + minute * 60 + second,
    hasSeconds: match[3] != null,
  };
};

const normalizedProfessional = (value: string | undefined): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const professionalsAreCompatible = (
  left: EvaluationScoreEntry,
  right: EvaluationScoreEntry
): boolean => {
  const a = normalizedProfessional(left.author);
  const b = normalizedProfessional(right.author);
  return !a || !b || a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
};

const itemAnswers = (entry: EvaluationScoreEntry): Map<string, string> =>
  new Map((entry.items ?? []).map(item => [item.id, JSON.stringify([item.value, item.valueName])]));

const itemPayloadsAreCompatible = (
  left: EvaluationScoreEntry,
  right: EvaluationScoreEntry
): boolean => {
  const leftAnswers = itemAnswers(left);
  const rightAnswers = itemAnswers(right);
  if (leftAnswers.size === 0 || rightAnswers.size === 0) return true;
  const [smaller, larger] =
    leftAnswers.size <= rightAnswers.size
      ? [leftAnswers, rightAnswers]
      : [rightAnswers, leftAnswers];
  return [...smaller].every(([id, answer]) => larger.get(id) === answer);
};

const sameStableApplication = (left: EvaluationScoreEntry, right: EvaluationScoreEntry): boolean =>
  left.encounterEventId > 0 && left.encounterEventId === right.encounterEventId;

const sameCrossSourceApplication = (
  left: EvaluationScoreEntry,
  right: EvaluationScoreEntry
): boolean => {
  const leftClock = clockParts(left.recordedAt);
  const rightClock = clockParts(right.recordedAt);
  if (
    left.code !== right.code ||
    left.recordedDate !== right.recordedDate ||
    left.total !== right.total ||
    !leftClock ||
    !rightClock ||
    leftClock.minute !== rightClock.minute
  )
    return false;

  const severityCompatible =
    left.severity == null || right.severity == null || left.severity === right.severity;
  if (!severityCompatible) return false;

  const exactClock =
    leftClock.hasSeconds && rightClock.hasSeconds && leftClock.seconds === rightClock.seconds;
  // Exact copies are one clinical application even if separate Rayen forms attribute different
  // professionals. This is the legacy shape observed for Franco Morales. Different second-precise
  // times remain distinct because they may be genuine rapid reassessments.
  if (exactClock) {
    return sameStableApplication(left, right) && itemPayloadsAreCompatible(left, right);
  }

  // Resumen omits seconds while Historial preserves them. Professional compatibility keeps this
  // deliberately broader minute match from joining two real applications by different nurses.
  return leftClock.hasSeconds !== rightClock.hasSeconds && professionalsAreCompatible(left, right);
};

const mergeHistoryCopies = (
  left: EvaluationScoreEntry,
  right: EvaluationScoreEntry
): EvaluationScoreEntry => {
  const leftPrecise = clockParts(left.recordedAt)?.hasSeconds === true;
  const rightPrecise = clockParts(right.recordedAt)?.hasSeconds === true;
  const preferred = rightPrecise && !leftPrecise ? right : left;
  const complement = preferred === left ? right : left;
  return {
    ...preferred,
    author: preferred.author || complement.author,
    authorRole: preferred.authorRole || complement.authorRole,
    severity: preferred.severity ?? complement.severity,
    archived: Boolean(preferred.archived && complement.archived),
  };
};

/** Defensive migration for histories stored before Resumen/Historial minute matching was added. */
export const dedupeScoreHistory = (entries: EvaluationScoreEntry[]): EvaluationScoreEntry[] => {
  const deduped: EvaluationScoreEntry[] = [];
  for (const entry of entries) {
    const duplicateIndex = deduped.findIndex(candidate =>
      sameCrossSourceApplication(candidate, entry)
    );
    if (duplicateIndex < 0) deduped.push(entry);
    else deduped[duplicateIndex] = mergeHistoryCopies(deduped[duplicateIndex], entry);
  }
  return deduped;
};

const applicationSortKey = (evidence: EvaluationScaleApplicationEvidence): number => {
  const day = evidence.recordedDate.replace(/-/g, '');
  const clock = evidence.recordedAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const time = clock
    ? `${String(Number(clock[1])).padStart(2, '0')}${clock[2]}${clock[3] ?? '00'}`
    : '000000';
  const key = Number(`${day}${time}`);
  return Number.isSafeInteger(key) ? key : 0;
};

const latestApplicationEvidence = (
  entry: EvaluationScoreEntry,
  history: EvaluationScoreEntry[]
): EvaluationScaleApplicationEvidence => {
  const candidates: EvaluationScaleApplicationEvidence[] = [
    applicationEvidence(entry),
    ...history
      // Any completed application of the same instrument advances its cadence, even when the
      // patient's score changed. The displayed result and latest application are intentionally
      // separate because Rayen may hide a newer application from the quick summary.
      .filter(candidate => candidate.code === entry.code && candidate.total != null)
      .map(applicationEvidence),
  ];
  return candidates.reduce((latest, candidate) =>
    applicationSortKey(candidate) > applicationSortKey(latest) ? candidate : latest
  );
};

export const buildScoresCellModel = (
  patient: PatientData,
  censusIsoDay: string
): ScoresCellModel => {
  const scores: PatientEvaluationScores = patient.evaluationScores ?? {};
  // Defensive filter for records persisted before census-day bounded histories were introduced.
  const history = dedupeScoreHistory(
    (scores.history ?? []).filter(
      entry => !/^\d{4}-\d{2}-\d{2}$/.test(entry.recordedDate) || entry.recordedDate <= censusIsoDay
    )
  );

  let braden: BradenCellModel | null = null;
  const ageYears = resolveAgeYears(patient, censusIsoDay);
  if (scores.braden && scores.braden.total != null && ageYears != null) {
    const application = latestApplicationEvidence(scores.braden, history);
    const assessment = assessBraden(
      scores.braden.total,
      ageYears,
      application.recordedDate,
      censusIsoDay
    );
    const { daysUntilDue, urgency } = assessment.reapplication;
    const sourceSeverity = scores.braden.severity?.trim() ?? '';
    braden = {
      entry: scores.braden,
      application,
      total: scores.braden.total,
      displayLevel: sourceSeverity ? parseSourceRiskLevel(sourceSeverity) : assessment.riskLevel,
      severityLabel: sourceRiskLabel(scores.braden.severity, assessment.conducta.riskLabel),
      assessment,
      chipCountdown: buildChipCountdown(daysUntilDue, urgency),
      countdownLabel: buildCountdownLabel(daysUntilDue, urgency),
    };
  }

  let downton: DowntonCellModel | null = null;
  if (scores.downton && scores.downton.total != null) {
    const application = latestApplicationEvidence(scores.downton, history);
    const cadenceLevel = parseDowntonCadenceLevel(scores.downton.severity);
    // Downton reapplies with the SAME cadence as Braden by risk level (bajo 7d · medio 3d · alto 1d).
    const reapplication = cadenceLevel
      ? bradenReapplicationStatus(application.recordedDate, cadenceLevel, censusIsoDay)
      : null;
    downton = {
      entry: scores.downton,
      application,
      total: scores.downton.total,
      displayLevel: parseSourceRiskLevel(scores.downton.severity),
      severityLabel: sourceRiskLabel(scores.downton.severity, ''),
      reapplication,
      chipCountdown: reapplication
        ? buildChipCountdown(reapplication.daysUntilDue, reapplication.urgency)
        : null,
      countdownLabel: reapplication
        ? buildCountdownLabel(reapplication.daysUntilDue, reapplication.urgency)
        : null,
    };
  }

  let cudyr: CudyrCellModel | null = null;
  const importedCudyr = scores.cudyr;
  if (
    importedCudyr &&
    importedCudyrBelongsToCensus(importedCudyr, censusIsoDay) &&
    /^[A-D][1-3]$/i.test(importedCudyr.category.trim())
  ) {
    const first = importedCudyr.category.trim().charAt(0).toUpperCase();
    cudyr = {
      entry: importedCudyr,
      category: importedCudyr.category.trim().toUpperCase(),
      band: first === 'A' || first === 'B' || first === 'C' || first === 'D' ? first : null,
    };
  }

  // Cell-level alert = the worst urgency across Braden and Downton (CUDYR has no cadence).
  const RANK: Record<ReapplicationUrgency, number> = { ok: 0, due: 1, overdue: 2 };
  const urgencies: ReapplicationUrgency[] = [
    braden?.assessment.reapplication.urgency ?? 'ok',
    downton?.reapplication?.urgency ?? 'ok',
  ];
  const alertUrgency = urgencies.reduce((worst, u) => (RANK[u] > RANK[worst] ? u : worst), 'ok');

  return {
    hasAny: braden != null || downton != null || cudyr != null || history.length > 0,
    braden,
    downton,
    cudyr,
    alertUrgency,
    history,
  };
};
