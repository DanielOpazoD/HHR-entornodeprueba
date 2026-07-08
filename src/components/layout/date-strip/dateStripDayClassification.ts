/**
 * Pure helpers to classify a date-strip day button against the clinical "today"
 * (the day the app wants the user editing, with the 08:00/09:00 shift rollover
 * applied — see resolveCurrentClinicalDay). Decoupled from the calendar date so the
 * HOY marker tracks the clinical day, not midnight: before the rollover the night
 * shift's clinical "today" is still the previous calendar day.
 */
export const buildDayDateString = (year: number, monthZeroBased: number, day: number): string =>
  `${year}-${String(monthZeroBased + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export interface DateStripDayClassification {
  /** This button is the active clinical day → gets the HOY marker. */
  isClinicalToday: boolean;
  /** This button is a clinical day already past (eligible for the "viewing past" marker). */
  isBeforeClinicalToday: boolean;
}

export const classifyDateStripDay = ({
  year,
  monthZeroBased,
  day,
  clinicalToday,
}: {
  year: number;
  monthZeroBased: number;
  day: number;
  clinicalToday: string;
}): DateStripDayClassification => {
  const dateString = buildDayDateString(year, monthZeroBased, day);
  return {
    // Lexicographic compare is chronological for YYYY-MM-DD.
    isClinicalToday: dateString === clinicalToday,
    isBeforeClinicalToday: dateString < clinicalToday,
  };
};
