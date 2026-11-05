/**
 * MMRAD writes study stamps as text: "DD/MM/YYYY", "DD/MM/YYYY HH:MM", sometimes with dots or
 * dashes. They carry no zone; they are the RIS wall clock and are only ordered and shown as text,
 * never turned into an instant (TIME-02).
 */
const STAMP = /(\d{2})[/.-](\d{2})[/.-](\d{4})(?:\s+(\d{2}):(\d{2}))?/;

export interface MmradStamp {
  day: string;
  month: string;
  year: string;
  hours: string | null;
  minutes: string | null;
}

export const parseMmradStamp = (raw: string): MmradStamp | null => {
  const [, day, month, year, hours = null, minutes = null] = STAMP.exec(raw ?? '') ?? [];
  return day && month && year ? { day, month, year, hours, minutes } : null;
};

/** Sortable "YYYY-MM-DD HH:MM" text; an unreadable stamp sorts last (empty string). */
export const mmradStampSortKey = (raw: string): string => {
  const stamp = parseMmradStamp(raw);
  if (!stamp) return '';
  return `${stamp.year}-${stamp.month}-${stamp.day} ${stamp.hours ?? '00'}:${stamp.minutes ?? '00'}`;
};

/** Newest first by the stamp itself; the input is not mutated. */
export const sortByMmradStampDesc = <T extends { fecha_examen: string }>(
  exams: readonly T[]
): T[] =>
  [...exams].sort((a, b) =>
    mmradStampSortKey(b.fecha_examen).localeCompare(mmradStampSortKey(a.fecha_examen))
  );

/** The stamp as the app writes dates: DD-MM-YYYY and, when MMRAD gave it, HH:MM. */
export const formatMmradStamp = (raw: string): string => {
  const stamp = parseMmradStamp(raw);
  if (!stamp) return raw;
  const time = stamp.hours && stamp.minutes ? ` ${stamp.hours}:${stamp.minutes}` : '';
  return `${stamp.day}-${stamp.month}-${stamp.year}${time}`;
};
