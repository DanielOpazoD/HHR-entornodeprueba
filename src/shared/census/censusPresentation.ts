import { formatCalendarDate, formatDateDDMMYYYY, formatTimestamp } from '@/utils/dateDisplayUtils';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

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

export const formatCensusDateTime = (isoTimestamp?: string | null, locale = 'es-CL'): string => {
  if (!isoTimestamp) {
    return 'sin registro';
  }

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }

  return parsed.toLocaleString(locale, {
    timeZone: CLINICAL_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
