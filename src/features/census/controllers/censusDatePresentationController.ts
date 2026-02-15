const parseIsoAtNoon = (isoDate: string): Date | null => {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

export const formatCensusHeaderDate = (isoDate: string, locale = 'es-CL'): string => {
  const parsed = parseIsoAtNoon(isoDate);
  if (!parsed) {
    return isoDate;
  }

  return parsed.toLocaleDateString(locale);
};
