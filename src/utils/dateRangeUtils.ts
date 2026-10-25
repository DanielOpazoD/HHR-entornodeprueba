import { calendarStampInClinicalTimeZone } from './clinicalTimeZone';
import { getTodayISO } from './dateCoreUtils';

export const daysBetween = (startDate: string, endDate: string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const getTimeRoundedToStep = (date: Date = new Date(), stepMinutes = 5): string => {
  const stepMs = stepMinutes * 60 * 1000;
  const roundedMs = Math.round(date.getTime() / stepMs) * stepMs;
  return calendarStampInClinicalTimeZone(new Date(roundedMs)).hhmm;
};

export const getDaysInMonth = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

export const generateDateRange = (
  year: number,
  month: number,
  limitToToday: boolean = false
): string[] => {
  const days = getDaysInMonth(year, month);
  const range: string[] = [];
  const monthStr = String(month).padStart(2, '0');
  const today = getTodayISO();

  for (let day = 1; day <= days; day++) {
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;
    if (limitToToday && dateStr > today) {
      break;
    }
    range.push(dateStr);
  }

  return range;
};
