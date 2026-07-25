const isIntegerInRange = (value: number, minimum: number, maximum: number): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

/** Builds a lexicographically sortable local timestamp, rejecting impossible calendar values. */
export const buildSortableLocalTimestamp = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string | null => {
  if (
    !isIntegerInRange(year, 1000, 9999) ||
    !isIntegerInRange(month, 1, 12) ||
    !isIntegerInRange(day, 1, 31) ||
    !isIntegerInRange(hour, 0, 23) ||
    !isIntegerInRange(minute, 0, 59) ||
    !isIntegerInRange(second, 0, 59)
  )
    return null;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    return null;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
};

/** Parses only complete ISO instants whose local calendar and UTC offset are both valid. */
export const parseStrictIsoInstant = (value: string): Date | null => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value
    );
  if (!match) return null;
  const validWallClock = buildSortableLocalTimestamp(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  );
  if (!validWallClock) return null;
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return null;
    }
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
};
