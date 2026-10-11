import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
export interface ShiftedMonthYear {
  month: number;
  year: number;
}

interface ResolveShiftedMonthYearParams {
  month: number;
  year: number;
  delta: number;
}

export const resolveShiftedMonthYear = ({
  month,
  year,
  delta,
}: ResolveShiftedMonthYearParams): ShiftedMonthYear => {
  let nextMonth = month + delta;
  let nextYear = year;

  while (nextMonth > 11) {
    nextMonth -= 12;
    nextYear += 1;
  }

  while (nextMonth < 0) {
    nextMonth += 12;
    nextYear -= 1;
  }

  return {
    month: nextMonth,
    year: nextYear,
  };
};

/** CUDYR opens completed months at their end; the current month stops at hospital today. */
export const resolveMonthLandingDay = (
  year: number,
  month: number,
  module: string,
  now = new Date()
): number => {
  if (module !== 'CUDYR') return 1;
  const today = getClinicalCalendarDateISO(now);
  const selected = `${year}-${String(month + 1).padStart(2, '0')}`;
  if (selected === today.slice(0, 7)) return Number(today.slice(8));
  if (selected > today.slice(0, 7)) return 1;
  return new Date(year, month + 1, 0).getDate();
};
