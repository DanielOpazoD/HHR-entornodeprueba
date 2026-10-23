import type { AuditTrailCounts } from '@/types/auditTrailTypes';
import { formatClinicalClock, formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';

export const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

/** `14:05`, `14:05–14:40`, or with the day when the period spans several days. */
export const formatAuditTrailMoment = (from: number, to: number, withDate: boolean): string => {
  const day = withDate ? `${formatClinicalDayMonthYear(to)} ` : '';
  const start = formatClinicalClock(from);
  const end = formatClinicalClock(to);
  if (start === end) return `${day}${end}`;
  const sameDay = formatClinicalDayMonthYear(from) === formatClinicalDayMonthYear(to);
  return sameDay
    ? `${day}${start}–${end}`
    : `${formatClinicalDayMonthYear(from)} ${start} – ${formatClinicalDayMonthYear(to)} ${end}`;
};

// Connection events are told by the session header and the timeline, not counted here.
const COUNT_WORDS: Array<[keyof AuditTrailCounts, string, string]> = [
  ['change', 'cambio', 'cambios'],
  ['access', 'acceso', 'accesos'],
  ['system', 'evento de sistema', 'eventos de sistema'],
];

/** "3 cambios · 1 acceso", omitting zeros. */
export const formatAuditTrailCounts = (counts: AuditTrailCounts): string =>
  COUNT_WORDS.filter(([key]) => counts[key] > 0)
    .map(([key, singular, plural]) => pluralize(counts[key], singular, plural))
    .join(' · ');

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40';
