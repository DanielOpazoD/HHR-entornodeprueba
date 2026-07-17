export const formatDateDDMMYYYY = (isoDate?: string): string => {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};

export const formatDateForDisplay = (date: Date): string =>
  date.toLocaleDateString('es-CL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export const formatTimeHHMM = (isoDateTime?: string): string => {
  if (!isoDateTime) return '--:--';

  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return '--:--';

  return date.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

/**
 * Formats an ISO date-time as a short es-CL date + 24-hour time
 * (e.g. `25-06-2026, 16:30`). The clock is pinned to 24h (`hour12: false`) so the
 * output is deterministic across runtimes instead of varying with the host ICU's
 * locale default. Returns the original input unchanged when it is not a parseable
 * date, matching the prescriptions/wound-care display contract.
 */
export const formatDateTimeCL = (isoDateTime: string, timeZone?: string): string => {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return isoDateTime;

  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
};
