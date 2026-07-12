/**
 * View-model for the latest vital signs synced from Ficha Médico. Pure and testable: turns a stored
 * `PatientVitalSigns` into an ordered list of readings, each flagged normal / warn / alert against
 * conservative adult reference ranges, plus a worst-status summary and a compact cell chip.
 *
 * The thresholds are deliberately simple screening bands (not age/context adjusted) — enough to draw
 * the eye to an out-of-range value in the census; the clinician confirms in context.
 */

import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

export type VitalStatus = 'normal' | 'warn' | 'alert';

export interface VitalReadingView {
  key: 'pa' | 'fc' | 'spo2' | 'temp' | 'fr' | 'eva';
  label: string;
  /** Formatted value, e.g. "130/82" or "36.5". */
  value: string;
  unit: string;
  status: VitalStatus;
}

export interface VitalSignsView {
  readings: VitalReadingView[];
  /** Worst status across all present readings — drives the cell chip colour. */
  worst: VitalStatus;
  recordedAt: string;
  recordedDate: string;
  observations: string | null;
  /** Very compact glance value for the census cell, e.g. "98% · 36.5°". */
  chip: string;
}

const RANK: Record<VitalStatus, number> = { normal: 0, warn: 1, alert: 2 };
const worseOf = (a: VitalStatus, b: VitalStatus): VitalStatus => (RANK[b] > RANK[a] ? b : a);

/** Classify a value into a band given [alertLow, warnLow, warnHigh, alertHigh] cut points. */
const band = (
  value: number,
  alertLow: number,
  warnLow: number,
  warnHigh: number,
  alertHigh: number
): VitalStatus => {
  if (value <= alertLow || value >= alertHigh) return 'alert';
  if (value < warnLow || value > warnHigh) return 'warn';
  return 'normal';
};

const spo2Status = (v: number): VitalStatus => (v < 90 ? 'alert' : v < 94 ? 'warn' : 'normal');
const tempStatus = (v: number): VitalStatus => band(v, 35, 35.5, 37.7, 39);
const hrStatus = (v: number): VitalStatus => band(v, 40, 50, 100, 130);
const rrStatus = (v: number): VitalStatus => band(v, 8, 12, 20, 25);
const sbpStatus = (v: number): VitalStatus => band(v, 90, 100, 160, 181);
const evaStatus = (v: number): VitalStatus => (v >= 7 ? 'alert' : v >= 4 ? 'warn' : 'normal');

/** Trim a trailing ".0" so "36.0" shows as "36". */
const fmt = (v: number): string => String(Number.isInteger(v) ? v : Number(v.toFixed(1)));

export const buildVitalSignsView = (
  vitals: PatientVitalSigns | undefined
): VitalSignsView | null => {
  if (!vitals) return null;
  const readings: VitalReadingView[] = [];

  if (vitals.systolic != null) {
    const value =
      vitals.diastolic != null ? `${vitals.systolic}/${vitals.diastolic}` : `${vitals.systolic}`;
    readings.push({
      key: 'pa',
      label: 'PA',
      value,
      unit: 'mmHg',
      status: sbpStatus(vitals.systolic),
    });
  }
  if (vitals.heartRate != null) {
    readings.push({
      key: 'fc',
      label: 'FC',
      value: fmt(vitals.heartRate),
      unit: 'lpm',
      status: hrStatus(vitals.heartRate),
    });
  }
  if (vitals.spo2 != null) {
    readings.push({
      key: 'spo2',
      label: 'SatO₂',
      value: fmt(vitals.spo2),
      unit: '%',
      status: spo2Status(vitals.spo2),
    });
  }
  if (vitals.temperature != null) {
    readings.push({
      key: 'temp',
      label: 'T°',
      value: fmt(vitals.temperature),
      unit: '°C',
      status: tempStatus(vitals.temperature),
    });
  }
  if (vitals.respiratoryRate != null) {
    readings.push({
      key: 'fr',
      label: 'FR',
      value: fmt(vitals.respiratoryRate),
      unit: 'rpm',
      status: rrStatus(vitals.respiratoryRate),
    });
  }
  if (vitals.painEva != null) {
    readings.push({
      key: 'eva',
      label: 'EVA',
      value: fmt(vitals.painEva),
      unit: '/10',
      status: evaStatus(vitals.painEva),
    });
  }

  if (readings.length === 0) return null;

  const worst = readings.reduce<VitalStatus>((acc, r) => worseOf(acc, r.status), 'normal');

  // Cell chip: prefer SatO₂ + T° (most glanceable); fall back to the first two readings.
  const pick = (key: VitalReadingView['key']): VitalReadingView | undefined =>
    readings.find(r => r.key === key);
  const chipReadings = [pick('spo2'), pick('temp')].filter((r): r is VitalReadingView => r != null);
  const chosen = chipReadings.length > 0 ? chipReadings : readings.slice(0, 2);
  const chip = chosen
    .map(r => `${r.value}${r.unit === '%' ? '%' : r.unit === '°C' ? '°' : ''}`)
    .join(' · ');

  return {
    readings,
    worst,
    recordedAt: vitals.recordedAt,
    recordedDate: vitals.recordedDate,
    observations: vitals.observations,
    chip,
  };
};
