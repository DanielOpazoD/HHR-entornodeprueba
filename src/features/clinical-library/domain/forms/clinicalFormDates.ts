/** Parse calendar dates without the browser timezone shifting the printed day. */
export const parseFormDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return { year, month, day, timestamp: date.getTime() };
};

export const formatFormDate = (value: string): string => {
  const date = parseFormDate(value);
  return date
    ? `${String(date.day).padStart(2, '0')}/${String(date.month).padStart(2, '0')}/${String(date.year).padStart(4, '0')}`
    : '';
};

export const formAgeAt = (birthDate: string, referenceDate: string): string => {
  const birth = parseFormDate(birthDate);
  const reference = parseFormDate(referenceDate);
  if (!birth || !reference || birth.timestamp > reference.timestamp) return '';
  const years =
    reference.year -
    birth.year -
    Number(
      reference.month < birth.month ||
        (reference.month === birth.month && reference.day < birth.day)
    );
  if (years > 0) return `${years} ${years === 1 ? 'año' : 'años'}`;
  const months =
    (reference.year - birth.year) * 12 +
    reference.month -
    birth.month -
    Number(reference.day < birth.day);
  if (months > 0) return `${months} ${months === 1 ? 'mes' : 'meses'}`;
  const days = Math.floor((reference.timestamp - birth.timestamp) / 86_400_000);
  return `${days} ${days === 1 ? 'día' : 'días'}`;
};
