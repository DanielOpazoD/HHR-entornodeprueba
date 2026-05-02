export const resolveTransferMonthKey = (value?: string): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;

  return `${match[1]}-${match[2]}`;
};

export const resolveTransferMonthKeyFromDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const isSameTransferOperationalMonth = (left?: string, right?: string): boolean => {
  const leftKey = resolveTransferMonthKey(left);
  const rightKey = resolveTransferMonthKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
};
