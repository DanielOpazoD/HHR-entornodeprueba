/** HCC summary dates are local wall-clock values, often YYYYMMDD HH:mm. */
export const formatClinicalAntecedentDate = (raw: string): string => {
  const match = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/);
  if (!match) return raw;
  const [, year, month, day, hour, minute] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() + 1 !== Number(month) ||
    calendar.getUTCDate() !== Number(day) ||
    (hour !== undefined && Number(hour) > 23) ||
    (minute !== undefined && Number(minute) > 59)
  )
    return raw;
  return `${day}-${month}-${year}${hour === undefined ? '' : ` ${hour}:${minute}`}`;
};
