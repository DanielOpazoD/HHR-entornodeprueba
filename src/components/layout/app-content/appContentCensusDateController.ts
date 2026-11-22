export interface CensusDateSelection {
  year: number;
  month: number;
  day: number;
}

export interface OpenCensusDateNavigationHandlers {
  setCurrentModule: (module: 'CENSUS') => void;
  setCensusViewMode: (mode: 'REGISTER') => void;
  setSelectedYear: (year: number) => void;
  setSelectedMonth: (month: number) => void;
  setSelectedDay: (day: number) => void;
}

export const resolveCensusDateSelection = (isoDate: string): CensusDateSelection | null => {
  const datePart = isoDate.split('T')[0];
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return null;
  }

  const [year, month, day] = datePart.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return { year, month: month - 1, day };
};

export const buildOpenCensusDateHandler =
  ({
    setCurrentModule,
    setCensusViewMode,
    setSelectedYear,
    setSelectedMonth,
    setSelectedDay,
  }: OpenCensusDateNavigationHandlers) =>
  (isoDate: string) => {
    const selection = resolveCensusDateSelection(isoDate);
    if (!selection) {
      return;
    }

    setCurrentModule('CENSUS');
    setCensusViewMode('REGISTER');
    setSelectedYear(selection.year);
    setSelectedMonth(selection.month);
    setSelectedDay(selection.day);
  };
