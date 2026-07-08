export type DailyRecordAuthorityMode = 'client_only' | 'shadow' | 'enforced';

const normalizeAuthorityMode = (value: unknown): DailyRecordAuthorityMode | undefined => {
  switch (String(value || '').trim()) {
    case 'client_only':
      return 'client_only';
    case 'shadow':
      return 'shadow';
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

export const shouldUseDailyRecordAuthorityCallable = (): boolean =>
  resolveDailyRecordAuthorityMode() === 'enforced';

export const shouldShadowDailyRecordAuthorityCallable = (): boolean =>
  resolveDailyRecordAuthorityMode() === 'shadow';
