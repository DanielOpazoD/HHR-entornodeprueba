/**
 * View-model for the latest vital signs synced from Ficha Médico. Pure and testable: turns a stored
 * `PatientVitalSigns` into an ordered list of readings, each flagged normal / warn / alert against
 * conservative reference ranges, plus a worst-status summary and a compact cell chip.
 *
 * These are screening bands, not diagnostic criteria. Pediatric rows use age-specific Queensland
 * Health CEWT profiles. RN remain a separate age-only profile.
 */

import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import {
  classifyVitalSign,
  type VitalSignsMetricKey,
  type VitalSignsProfile,
  type VitalStatus,
} from '@/constants/vitalSignsThresholds';

export type { VitalSignsProfile, VitalStatus } from '@/constants/vitalSignsThresholds';

export interface VitalReadingView {
  key: VitalSignsMetricKey;
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
  profile: VitalSignsProfile;
  /** Very compact glance value for the census cell, e.g. "98% · 36.5°". */
  chip: string;
}

const RANK: Record<VitalStatus, number> = { neutral: -1, normal: 0, warn: 1, alert: 2 };
const worseOf = (a: VitalStatus, b: VitalStatus): VitalStatus => (RANK[b] > RANK[a] ? b : a);

/** Trim a trailing ".0" so "36.0" shows as "36". */
const fmt = (v: number): string => String(Number.isInteger(v) ? v : Number(v.toFixed(1)));

export const buildVitalSignsView = (
  vitals: PatientVitalSigns | undefined,
  profile: VitalSignsProfile = 'adult'
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
      status: classifyVitalSign(profile, 'pa', vitals.systolic),
    });
  }
  if (vitals.heartRate != null) {
    readings.push({
      key: 'fc',
      label: 'FC',
      value: fmt(vitals.heartRate),
      unit: 'lpm',
      status: classifyVitalSign(profile, 'fc', vitals.heartRate),
    });
  }
  if (vitals.spo2 != null) {
    readings.push({
      key: 'spo2',
      label: 'SatO₂',
      value: fmt(vitals.spo2),
      unit: '%',
      status: classifyVitalSign(profile, 'spo2', vitals.spo2),
    });
  }
  if (vitals.temperature != null) {
    readings.push({
      key: 'temp',
      label: 'T°',
      value: fmt(vitals.temperature),
      unit: '°C',
      status: classifyVitalSign(profile, 'temp', vitals.temperature),
    });
  }
  if (vitals.respiratoryRate != null) {
    readings.push({
      key: 'fr',
      label: 'FR',
      value: fmt(vitals.respiratoryRate),
      unit: 'rpm',
      status: classifyVitalSign(profile, 'fr', vitals.respiratoryRate),
    });
  }
  if (vitals.painEva != null) {
    readings.push({
      key: 'eva',
      label: 'EVA',
      value: fmt(vitals.painEva),
      unit: '/10',
      status: classifyVitalSign(profile, 'eva', vitals.painEva),
    });
  }
  if (vitals.hgt != null) {
    readings.push({
      key: 'hgt',
      label: 'HGT',
      value: fmt(vitals.hgt),
      unit: 'mg/dL',
      status: classifyVitalSign(profile, 'hgt', vitals.hgt),
    });
  }
  // Rapid insulin administered: units + abdominal quadrant ("Ins/Cuad"). Not a range — shown neutral.
  if (vitals.insulinUnits != null || vitals.insulinQuadrant) {
    const parts = [
      vitals.insulinUnits != null ? fmt(vitals.insulinUnits) : '',
      vitals.insulinQuadrant || '',
    ].filter(Boolean);
    if (parts.length > 0) {
      readings.push({
        key: 'ins',
        label: 'Ins/Cuad',
        value: parts.join(' · '),
        unit: 'UI',
        status: classifyVitalSign(profile, 'ins', vitals.insulinUnits ?? 0),
      });
    }
  }

  if (readings.length === 0) return null;

  const worst = readings.reduce<VitalStatus>((acc, r) => worseOf(acc, r.status), 'neutral');

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
    profile,
    chip,
  };
};

/** Columns of the vitals history table, in clinical reading order. */
export const VITALS_HISTORY_COLUMNS: ReadonlyArray<{
  key: VitalReadingView['key'];
  label: string;
}> = [
  { key: 'pa', label: 'PA' },
  { key: 'fc', label: 'FC' },
  { key: 'spo2', label: 'SAT' },
  { key: 'temp', label: 'T°' },
  { key: 'fr', label: 'FR' },
  { key: 'eva', label: 'EVA' },
  { key: 'hgt', label: 'HGT' },
  { key: 'ins', label: 'Ins/Cuad' },
];

export interface VitalsHistoryRow {
  key: string;
  /** ISO day (YYYY-MM-DD) — used to group rows by day. */
  recordedDate: string;
  /** Compact "DD-MM HH:MM" for the row. */
  when: string;
  observations: string | null;
  /** Value + status per column key (absent readings omitted). */
  cells: Partial<Record<VitalReadingView['key'], { value: string; status: VitalStatus }>>;
}

const dayLabel = (isoDay: string): string => {
  const m = isoDay.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}-${m[1]}` : isoDay;
};
const timeLabel = (recordedAt: string): string => {
  const m = recordedAt.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

/** Build table rows (most-recent-first, as given) for the vitals history view. */
export const buildVitalsHistory = (
  records: readonly PatientVitalSigns[],
  profile: VitalSignsProfile | ((record: PatientVitalSigns) => VitalSignsProfile) = 'adult'
): VitalsHistoryRow[] =>
  records.map((record, index) => {
    const resolvedProfile = typeof profile === 'function' ? profile(record) : profile;
    const view = buildVitalSignsView(record, resolvedProfile);
    const cells: VitalsHistoryRow['cells'] = {};
    view?.readings.forEach(reading => {
      cells[reading.key] = { value: reading.value, status: reading.status };
    });
    return {
      key: `${record.recordedAt}-${index}`,
      recordedDate: record.recordedDate,
      when: `${dayLabel(record.recordedDate)} ${timeLabel(record.recordedAt)}`.trim(),
      observations: record.observations,
      cells,
    };
  });
