import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { addCalendarDays, calendarDayAtUtcNoon } from '@/utils/clinicalDateUtils';
import { DateRangePreset } from '@/features/analytics/types/minsalTypes';

/** Calculate date range from preset. */
export function getDateRangeFromPreset(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  currentYearMonth?: number
): { startDate: string; endDate: string } {
  const todayIso = getClinicalCalendarDateISO();
  const today = calendarDayAtUtcNoon(todayIso);
  const lastDays = (count: number) => ({
    startDate: addCalendarDays(todayIso, 1 - count),
    endDate: todayIso,
  });

  // clinical-clock-allow instant-calendar-slice: Preset bounds are calendar days anchored at UTC noon, not event instants.
  const formatDate = (d: Date): string => d.toISOString().slice(0, 10);

  switch (preset) {
    case 'today':
      return lastDays(1);

    case 'last7days':
      return lastDays(7);

    case 'lastMonth':
      // Rolling 30 days including today
      return lastDays(30);

    case 'currentMonth': {
      // Configurable month in current year.
      const normalizedMonth = Math.min(
        12,
        Math.max(1, currentYearMonth ?? today.getUTCMonth() + 1)
      );
      const monthIndex = normalizedMonth - 1;
      const year = today.getUTCFullYear();
      const start = new Date(Date.UTC(year, monthIndex, 1, 12));
      const end =
        monthIndex === today.getUTCMonth()
          ? today
          : new Date(Date.UTC(year, monthIndex + 1, 0, 12));
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }

    case 'yearToDate': {
      const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1, 12));
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'last3Months':
      return lastDays(90);

    case 'last6Months':
      return lastDays(180);

    case 'last12Months':
      return lastDays(365);

    case 'custom':
      if (!customStart || !customEnd) {
        throw new Error('Custom date range requires start and end dates');
      }
      return { startDate: customStart, endDate: customEnd };

    default:
      return lastDays(1);
  }
}
