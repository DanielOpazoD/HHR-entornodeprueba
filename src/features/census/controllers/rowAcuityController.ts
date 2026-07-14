/**
 * Per-row clinical acuity for the census (rediseño 2026). Pure + testable: derives, from a patient's
 * already-synced data, whether the row needs attention and why — driving the left "acuity rail" on
 * the row and the census "requieren atención" triage bar. It reuses the SAME thresholds the scale
 * cell already shows (reapplication cadence), so the rail can never disagree with the cell.
 *
 * Vital signs are DELIBERATELY not a source: their screening bands over-flag borderline values, so
 * they are shown in the Signos cell but never raise a row-level alert.
 *
 *   alert  → an overdue nursing scale.
 *   watch  → a scale due today, or isolation.
 *   none   → nothing surfaced.
 */

import { buildScoresCellModel } from './evaluationScoresCellController';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';

export type RowAcuityLevel = 'none' | 'watch' | 'alert';
export type CensusAttentionFilter = 'all' | 'attention' | 'scale' | 'isolation';

/** A single reason a row is flagged, plus the category so the triage bar can tally by kind. */
export interface RowAcuityReason {
  kind: 'scale' | 'isolation';
  level: 'watch' | 'alert';
  label: string;
}

export interface RowAcuity {
  level: RowAcuityLevel;
  reasons: RowAcuityReason[];
}

const RANK: Record<RowAcuityLevel, number> = { none: 0, watch: 1, alert: 2 };

/** Push ONE scale reason per pending nursing scale, so a patient with two overdue scales counts as
 * two (see the triage bar). `overdue` → alert, `due` → watch. */
const pushScaleReason = (
  reasons: RowAcuityReason[],
  name: string,
  urgency: 'ok' | 'due' | 'overdue' | undefined
): void => {
  if (urgency === 'overdue')
    reasons.push({ kind: 'scale', level: 'alert', label: `${name} vencida` });
  else if (urgency === 'due')
    reasons.push({ kind: 'scale', level: 'watch', label: `${name} por reaplicar` });
};

export const buildRowAcuity = (patient: PatientData, censusIsoDay: string): RowAcuity => {
  const reasons: RowAcuityReason[] = [];

  const scores = buildScoresCellModel(patient, censusIsoDay);
  pushScaleReason(reasons, 'Braden', scores.braden?.assessment.reapplication.urgency);
  pushScaleReason(reasons, 'Downton', scores.downton?.reapplication?.urgency);

  if (patient.isIsolated) {
    reasons.push({ kind: 'isolation', level: 'watch', label: 'Paciente en aislamiento' });
  }

  const level = reasons.reduce<RowAcuityLevel>(
    (worst, reason) => (RANK[reason.level] > RANK[worst] ? reason.level : worst),
    'none'
  );

  return { level, reasons };
};

/** Census-wide triage tally for the "requieren atención" bar. `rows`/`alertRows`/`isolation` count
 * PATIENTS, while `scale` counts individual pending scales (a patient with two overdue scales adds
 * two — that's what the nurse must reapply). */
export interface CensusAttentionSummary {
  /** Rows needing any attention (level !== 'none'). */
  rows: number;
  /** Rows at alert level (the most urgent). */
  alertRows: number;
  /** Total pending nursing scales across the census (not rows). */
  scale: number;
  isolation: number;
}

export const buildCensusAttentionSummary = (
  beds: Record<string, PatientData>,
  censusIsoDay: string
): CensusAttentionSummary => {
  const summary: CensusAttentionSummary = { rows: 0, alertRows: 0, scale: 0, isolation: 0 };

  const tallyPatient = (patient: PatientData): void => {
    if (!patient?.patientName?.trim() || patient.isBlocked) return;
    const { level, reasons } = buildRowAcuity(patient, censusIsoDay);
    if (level !== 'none') {
      summary.rows += 1;
      if (level === 'alert') summary.alertRows += 1;
      summary.scale += reasons.filter(reason => reason.kind === 'scale').length;
      if (reasons.some(reason => reason.kind === 'isolation')) summary.isolation += 1;
    }

    if (patient.clinicalCrib && !patient.isBlocked) {
      tallyPatient(patient.clinicalCrib);
    }
  };

  for (const patient of Object.values(beds)) {
    tallyPatient(patient);
  }
  return summary;
};

const rowMatchesAttentionFilter = (
  row: UnifiedBedRow,
  censusIsoDay: string,
  filter: Exclude<CensusAttentionFilter, 'all'>
): boolean => {
  if (row.kind !== 'occupied' || row.data.isBlocked || !row.data.patientName?.trim()) return false;

  const acuity = buildRowAcuity(row.data, censusIsoDay);
  if (filter === 'attention') return acuity.level !== 'none';
  return acuity.reasons.some(reason => reason.kind === filter);
};

/** Applies surveillance mode to already-resolved census rows. It never mutates or reorders rows;
 * empty beds simply disappear while a clinical attention filter is active. */
export const filterCensusRowsByAttention = (
  rows: UnifiedBedRow[],
  censusIsoDay: string,
  filter: CensusAttentionFilter
): UnifiedBedRow[] => {
  if (filter === 'all') return rows;
  return rows.filter(row => rowMatchesAttentionFilter(row, censusIsoDay, filter));
};

export const getCensusAttentionFilterLabel = (
  filter: Exclude<CensusAttentionFilter, 'all'>
): string => {
  if (filter === 'scale') return 'Escalas por reaplicar';
  if (filter === 'isolation') return 'Pacientes en aislamiento';
  return 'Pacientes que requieren atención';
};
