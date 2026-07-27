/**
 * View-model for the census "Scores" column (nursing risk scales). Pure and testable: given the
 * patient and the census day it derives what the cell and detail modal display — Braden risk level
 * with its reapplication countdown ("faltan X días" → "Reaplicar hoy" → "Vencida hace X días") and
 * the Downton severity — from the stored totals (see `@/domain/evaluationScales/bradenRisk`).
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
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';

export interface BradenCellModel {
  entry: EvaluationScoreEntry;
  application: EvaluationScaleApplicationEvidence;
  total: number;
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
  /** Risk level parsed from the source severity text ("Riesgo alto" → 'alto'); null if unknown. */
  level: BradenRiskLevel | null;
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

/** Downton has no local conducta table yet — level comes from the source severity text. */
const parseSeverityLevel = (severity: string | null): BradenRiskLevel | null => {
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
  };

const clockParts = (value: string): { minute: string; hasSeconds: boolean } | null => {
  const match = value.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    minute: `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`,
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
    leftClock.minute !== rightClock.minute ||
    !professionalsAreCompatible(left, right)
  )
    return false;

  const severityCompatible =
    left.severity == null || right.severity == null || left.severity === right.severity;
  if (!severityCompatible) return false;

  // Exact duplicate, or the known Resumen (minute) + Historial (seconds) representation. Two
  // second-precise events remain distinct because they may be genuine repeated assessments.
  return (
    left.encounterEventId === right.encounterEventId ||
    leftClock.hasSeconds !== rightClock.hasSeconds
  );
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
    braden = {
      entry: scores.braden,
      application,
      total: scores.braden.total,
      assessment,
      chipCountdown: buildChipCountdown(daysUntilDue, urgency),
      countdownLabel: buildCountdownLabel(daysUntilDue, urgency),
    };
  }

  let downton: DowntonCellModel | null = null;
  if (scores.downton && scores.downton.total != null) {
    const application = latestApplicationEvidence(scores.downton, history);
    const level = parseSeverityLevel(scores.downton.severity);
    // Downton reapplies with the SAME cadence as Braden by risk level (bajo 7d · medio 3d · alto 1d).
    const reapplication = level
      ? bradenReapplicationStatus(application.recordedDate, level, censusIsoDay)
      : null;
    downton = {
      entry: scores.downton,
      application,
      total: scores.downton.total,
      level,
      severityLabel: scores.downton.severity ?? '',
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
