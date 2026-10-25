export const normalizeDateOnly = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.split('T')[0];
};

export const normalizeCalendarDate = (value?: string): string | undefined => {
  if (!value) return undefined;

  const datePart = value.split('T')[0].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(datePart)) {
    const [day, month, year] = datePart.split('-');
    return `${year}-${month}-${day}`;
  }

  return undefined;
};

export const parseCalendarDateUtcNoon = (value?: string): number | null => {
  const normalized = normalizeCalendarDate(value);
  if (!normalized) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  if ([year, month, day].some(part => Number.isNaN(part))) {
    return null;
  }

  return Date.UTC(year, month - 1, day, 12, 0, 0);
};

export const addCalendarDays = (dateString: string, days: number): string => {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  // clinical-clock-allow instant-calendar-slice: date represents the input calendar day shifted from noon; it is not an event instant.
  return date.toISOString().split('T')[0];
};

export const diffCalendarDays = (startDate?: string, endDate?: string): number | null => {
  const start = parseCalendarDateUtcNoon(startDate);
  const end = parseCalendarDateUtcNoon(endDate);
  if (start === null || end === null) {
    return null;
  }

  return Math.round((end - start) / (1000 * 60 * 60 * 24));
};
