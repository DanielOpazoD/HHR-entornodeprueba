export type DailyRecordAuthorityMode = 'client_only' | 'enforced';

const normalizeAuthorityMode = (value: unknown): DailyRecordAuthorityMode | undefined => {
  switch (String(value || '').trim()) {
    case 'client_only':
      return 'client_only';
    case 'enforced':
      return 'enforced';
    default:
      return undefined;
  }
};

export const resolveDailyRecordAuthorityMode = (): DailyRecordAuthorityMode => {
  const explicitMode = normalizeAuthorityMode(import.meta.env.VITE_DAILY_RECORD_AUTHORITY_MODE);
  if (explicitMode) {
    return explicitMode;
  }

  if (import.meta.env.VITE_DAILY_RECORD_AUTHORITY_CALLABLE === 'true') {
    return 'enforced';
  }

  return 'client_only';
};
