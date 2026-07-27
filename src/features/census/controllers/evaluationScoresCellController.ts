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

export const buildScoresCellModel = (
  patient: PatientData,
  censusIsoDay: string
): ScoresCellModel => {
  const scores: PatientEvaluationScores = patient.evaluationScores ?? {};

  let braden: BradenCellModel | null = null;
  const ageYears = resolveAgeYears(patient, censusIsoDay);
  if (scores.braden && scores.braden.total != null && ageYears != null) {
    const application = applicationEvidence(scores.braden);
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
    const application = applicationEvidence(scores.downton);
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

  // Defensive filter for records persisted before census-day bounded histories were introduced.
  const history = (scores.history ?? []).filter(
    entry => !/^\d{4}-\d{2}-\d{2}$/.test(entry.recordedDate) || entry.recordedDate <= censusIsoDay
  );

  return {
    hasAny: braden != null || downton != null || cudyr != null || history.length > 0,
    braden,
    downton,
    cudyr,
    alertUrgency,
    history,
  };
};
