export const flag = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  const normalized =
    value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 's' ||
    normalized === 'si' ||
    normalized === 'sí'
  );
};

export const timeKey = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const dayKey = (value: string): string => {
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};
