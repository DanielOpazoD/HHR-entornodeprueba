/**
 * Per-row clinical acuity for the census (rediseño 2026). Pure + testable: derives, from a patient's
 * already-synced data, whether the row needs attention and why — driving the left "acuity rail" on
 * the row and the census "requieren atención" triage bar. It reuses the SAME thresholds the cells
 * already show (vital bands, scale reapplication), so the rail can never disagree with the cell it
 * summarizes.
 *
 *   alert  → a critical vital (worst = 'alert') OR an overdue nursing scale.
 *   watch  → an out-of-range vital (worst = 'warn'), a scale due today, or isolation.
 *   none   → nothing surfaced.
 */

import { buildVitalSignsView } from './vitalSignsView';
import { buildScoresCellModel } from './evaluationScoresCellController';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';

export type RowAcuityLevel = 'none' | 'watch' | 'alert';

/** A single reason a row is flagged, plus the category so the triage bar can tally by kind. */
export interface RowAcuityReason {
  kind: 'vital' | 'scale' | 'isolation';
  level: 'watch' | 'alert';
  label: string;
}

export interface RowAcuity {
  level: RowAcuityLevel;
  reasons: RowAcuityReason[];
}

const RANK: Record<RowAcuityLevel, number> = { none: 0, watch: 1, alert: 2 };

export const buildRowAcuity = (patient: PatientData, censusIsoDay: string): RowAcuity => {
  const reasons: RowAcuityReason[] = [];

  const vitals = buildVitalSignsView(patient.vitalSigns);
  if (vitals?.worst === 'alert') {
    reasons.push({ kind: 'vital', level: 'alert', label: 'Signo vital crítico' });
  } else if (vitals?.worst === 'warn') {
    reasons.push({ kind: 'vital', level: 'watch', label: 'Signo vital alterado' });
  }

  const scores = buildScoresCellModel(patient, censusIsoDay);
  if (scores.alertUrgency === 'overdue') {
    reasons.push({ kind: 'scale', level: 'alert', label: 'Escala de riesgo vencida' });
  } else if (scores.alertUrgency === 'due') {
    reasons.push({ kind: 'scale', level: 'watch', label: 'Escala de riesgo por reaplicar' });
  }

  if (patient.isIsolated) {
    reasons.push({ kind: 'isolation', level: 'watch', label: 'Paciente en aislamiento' });
  }

  const level = reasons.reduce<RowAcuityLevel>(
    (worst, reason) => (RANK[reason.level] > RANK[worst] ? reason.level : worst),
    'none'
  );

  return { level, reasons };
};

/** Census-wide triage tally for the "requieren atención" bar. Counts ROWS per kind (a row with two
 * reasons of the same kind counts once), plus how many rows reach alert level. */
export interface CensusAttentionSummary {
  /** Rows needing any attention (level !== 'none'). */
  rows: number;
  /** Rows at alert level (the most urgent). */
  alertRows: number;
  vital: number;
  scale: number;
  isolation: number;
}

export const buildCensusAttentionSummary = (
  beds: Record<string, PatientData>,
  censusIsoDay: string
): CensusAttentionSummary => {
  const summary: CensusAttentionSummary = {
    rows: 0,
    alertRows: 0,
    vital: 0,
    scale: 0,
    isolation: 0,
  };
  for (const patient of Object.values(beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const { level, reasons } = buildRowAcuity(patient, censusIsoDay);
    if (level === 'none') continue;
    summary.rows += 1;
    if (level === 'alert') summary.alertRows += 1;
    const kinds = new Set(reasons.map(reason => reason.kind));
    if (kinds.has('vital')) summary.vital += 1;
    if (kinds.has('scale')) summary.scale += 1;
    if (kinds.has('isolation')) summary.isolation += 1;
  }
  return summary;
};
