import { formatCalendarDate, formatDateDDMMYYYY, formatTimestamp } from '@/utils/dateDisplayUtils';

/** Short date of a `YYYY-MM-DD` calendar day, or of a timestamp on the hospital clock. */
export const formatCensusIsoDate = (isoDate: string, locale = 'es-CL'): string =>
  formatCalendarDate(isoDate, {}, locale) ??
  formatTimestamp(isoDate, { day: '2-digit', month: '2-digit', year: 'numeric' }, locale) ??
  isoDate;

export const formatCensusShortDayMonth = (isoDate: string, locale = 'es-CL'): string => {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) {
    return '--/--';
  }

  void locale;
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
};

export const formatCensusRouteDateLabel = (isoDate?: string): string =>
  isoDate ? formatDateDDMMYYYY(isoDate) : 'Sin fecha';

export const formatCensusMonthName = (isoDate: string, locale = 'es-CL'): string => {
  const monthName = formatCalendarDate(isoDate, { month: 'long' }, locale);
  if (!monthName) {
    return isoDate;
  }

  return monthName.charAt(0).toUpperCase() + monthName.slice(1);
};
