/**
 * View-model for the census "Scores" column (nursing risk scales). Pure and testable: given the
 * patient and the census day it derives what the cell and detail modal display — Braden risk level
 * with its reapplication countdown ("faltan X días" → "Reaplicar hoy" → "Vencida hace X días") and
 * the Downton severity — from the stored totals (see `@/domain/evaluationScales/bradenRisk`).
 */

import {
  assessBraden,
  type BradenAssessment,
  type ReapplicationUrgency,
} from '@/domain/evaluationScales/bradenRisk';
import type {
  BradenRiskLevel,
  EvaluationScoreEntry,
  PatientEvaluationScores,
} from '@/types/domain/evaluationScores';
import type { PatientData } from '@/types/domain/patient';

export interface BradenCellModel {
  entry: EvaluationScoreEntry;
  total: number;
  assessment: BradenAssessment;
  /** Short in-cell countdown chip, e.g. "5d" | "hoy" | "-2d". */
  chipCountdown: string;
  /** Full countdown sentence for the detail view, e.g. "Faltan 5 días para repetir la escala". */
  countdownLabel: string;
}

export interface DowntonCellModel {
  entry: EvaluationScoreEntry;
  total: number;
  /** Risk level parsed from the source severity text ("Riesgo alto" → 'alto'); null if unknown. */
  level: BradenRiskLevel | null;
  severityLabel: string;
}

export interface ScoresCellModel {
  hasAny: boolean;
  braden: BradenCellModel | null;
  downton: DowntonCellModel | null;
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

export const buildScoresCellModel = (
  patient: PatientData,
  censusIsoDay: string
): ScoresCellModel => {
  const scores: PatientEvaluationScores = patient.evaluationScores ?? {};

  let braden: BradenCellModel | null = null;
  const ageYears = resolveAgeYears(patient, censusIsoDay);
  if (scores.braden && scores.braden.total != null && ageYears != null) {
    const assessment = assessBraden(
      scores.braden.total,
      ageYears,
      scores.braden.recordedDate,
      censusIsoDay
    );
    const { daysUntilDue, urgency } = assessment.reapplication;
    braden = {
      entry: scores.braden,
      total: scores.braden.total,
      assessment,
      chipCountdown: buildChipCountdown(daysUntilDue, urgency),
      countdownLabel: buildCountdownLabel(daysUntilDue, urgency),
    };
  }

  let downton: DowntonCellModel | null = null;
  if (scores.downton && scores.downton.total != null) {
    downton = {
      entry: scores.downton,
      total: scores.downton.total,
      level: parseSeverityLevel(scores.downton.severity),
      severityLabel: scores.downton.severity ?? '',
    };
  }

  return {
    hasAny: braden != null || downton != null,
    braden,
    downton,
    // Downton has no reapplication cadence yet, so the cell alert follows Braden alone.
    alertUrgency: braden ? braden.assessment.reapplication.urgency : 'ok',
    history: scores.history ?? [],
  };
};
