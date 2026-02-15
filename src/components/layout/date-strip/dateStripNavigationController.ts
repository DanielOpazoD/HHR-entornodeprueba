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
