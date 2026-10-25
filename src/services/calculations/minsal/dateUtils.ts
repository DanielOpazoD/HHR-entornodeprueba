import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { DateRangePreset } from '@/types/minsalTypes';

/** Calculate date range from preset. */
export function getDateRangeFromPreset(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  currentYearMonth?: number
): { startDate: string; endDate: string } {
  const today = new Date(`${getClinicalCalendarDateISO()}T12:00:00Z`);

  // clinical-clock-allow instant-calendar-slice: Preset bounds are calendar days anchored at UTC noon, not event instants.
  const formatDate = (d: Date): string => d.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { startDate: formatDate(today), endDate: formatDate(today) };

    case 'last7days': {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 6);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'lastMonth': {
      // Rolling 30 days including today
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 29);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

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

    case 'last3Months': {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 89);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'last6Months': {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 179);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'last12Months': {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 364);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'custom':
      if (!customStart || !customEnd) {
        throw new Error('Custom date range requires start and end dates');
      }
      return { startDate: customStart, endDate: customEnd };

    default:
      return { startDate: formatDate(today), endDate: formatDate(today) };
  }
}
