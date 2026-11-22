import { calendarStampInClinicalTimeZone } from './clinicalTimeZone';
import { getTodayISO } from './dateCoreUtils';

export const getTimeRoundedToStep = (date: Date = new Date(), stepMinutes = 5): string => {
  const stepMs = stepMinutes * 60 * 1000;
  const roundedMs = Math.round(date.getTime() / stepMs) * stepMs;
  return calendarStampInClinicalTimeZone(new Date(roundedMs)).hhmm;
};

export const getDaysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

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
