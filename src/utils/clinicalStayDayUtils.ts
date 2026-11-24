import { diffCalendarDays, parseCalendarDateUtcNoon } from './clinicalDateUtils';

export const calculateHospitalizedDays = (
  admissionDate?: string,
  currentDate?: string
): number | null => {
  if (!admissionDate || !currentDate) return null;

  try {
    const calendarDiff = diffCalendarDays(admissionDate, currentDate);
    if (calendarDiff === null) {
      return null;
    }

    const diffDays = calendarDiff + 1;
    return diffDays < 1 ? 1 : diffDays;
  } catch {
    return null;
  }
};

/**
 * Inclusive days since a clinical device was installed.
 * The installation calendar day counts as Day 1, independent of local DST transitions.
 */
export const calculateDeviceDays = (installDate?: string, currentDate?: string): number | null => {
  const calendarDiff = diffCalendarDays(installDate, currentDate);
  if (calendarDiff === null) {
    return null;
  }

  return Math.max(1, calendarDiff + 1);
};

export const calculateOperationalHospitalizedDays = (
  admissionDate?: string,
  currentDate?: string
): number | null => {
  const calendarDiff = diffCalendarDays(admissionDate, currentDate);
  if (calendarDiff === null) {
    return null;
  }

  return calendarDiff >= 0 ? calendarDiff : 0;
};

/**
 * DEIS/MINSAL discharge stay rule:
 * - difference between discharge date and admission date
 * - same-day admission/discharge counts as 1
 * - invalid chronology is excluded from the indicator (null)
 */
export const calculateDischargeStayDays = (
  admissionDate?: string,
  dischargeDate?: string
): number | null => {
  const start = parseCalendarDateUtcNoon(admissionDate);
  const end = parseCalendarDateUtcNoon(dischargeDate);
  if (start === null || end === null) {
    return null;
  }

  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return null;
  }

  return diffDays === 0 ? 1 : diffDays;
};
