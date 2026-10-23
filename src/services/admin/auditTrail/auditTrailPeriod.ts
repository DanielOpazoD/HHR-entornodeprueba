import {
  addClinicalDays,
  clinicalDayStartEpochMs,
  formatClinicalDayMonthYear,
} from '@/utils/clinicalTimeFormat';

export type AuditTrailPeriodKind = 'day' | 'week' | 'month' | 'range';

/** Inclusive hospital calendar days (`YYYY-MM-DD`). */
export interface AuditTrailPeriod {
  kind: AuditTrailPeriodKind;
  startDate: string;
  endDate: string;
}

export const AUDIT_TRAIL_PERIOD_LABELS: Record<AuditTrailPeriodKind, string> = {
  day: 'Día',
  week: '7 días',
  month: '30 días',
  range: 'Rango',
};

const SPAN_DAYS: Record<Exclude<AuditTrailPeriodKind, 'range'>, number> = {
  day: 1,
  week: 7,
  month: 30,
};

export const buildAuditTrailPeriod = (
  kind: Exclude<AuditTrailPeriodKind, 'range'>,
  endDate: string
): AuditTrailPeriod => ({
  kind,
  startDate: addClinicalDays(endDate, 1 - SPAN_DAYS[kind]),
  endDate,
});

export const buildAuditTrailRange = (startDate: string, endDate: string): AuditTrailPeriod =>
  startDate <= endDate
    ? { kind: 'range', startDate, endDate }
    : { kind: 'range', startDate: endDate, endDate: startDate };

const spanOf = (period: AuditTrailPeriod): number =>
  Math.round(
    (Date.parse(`${period.endDate}T00:00:00Z`) - Date.parse(`${period.startDate}T00:00:00Z`)) /
      86_400_000
  ) + 1;

/** Moves the whole window back (-1) or forward (+1) by its own length. */
export const shiftAuditTrailPeriod = (
  period: AuditTrailPeriod,
  direction: -1 | 1
): AuditTrailPeriod => {
  const days = spanOf(period) * direction;
  return {
    ...period,
    startDate: addClinicalDays(period.startDate, days),
    endDate: addClinicalDays(period.endDate, days),
  };
};

/** Firestore range over `timestamp` (ISO strings): `[from, to)`. */
export const resolveAuditTrailQueryRange = (
  period: AuditTrailPeriod
): { fromIso: string; toIso: string } => ({
  fromIso: new Date(clinicalDayStartEpochMs(period.startDate)).toISOString(),
  toIso: new Date(clinicalDayStartEpochMs(addClinicalDays(period.endDate, 1))).toISOString(),
});

export const formatAuditTrailPeriod = (period: AuditTrailPeriod): string =>
  period.startDate === period.endDate
    ? formatClinicalDayMonthYear(period.endDate)
    : `${formatClinicalDayMonthYear(period.startDate)} – ${formatClinicalDayMonthYear(period.endDate)}`;
