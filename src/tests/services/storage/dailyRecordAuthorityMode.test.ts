import { beforeEach, describe, expect, it } from 'vitest';
import {
  resolveDailyRecordAuthorityMode,
  shouldUseDailyRecordAuthorityCallable,
  shouldShadowDailyRecordAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityMode';

describe('dailyRecordAuthorityMode', () => {
  beforeEach(() => {
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    delete (import.meta.env as Record<string, string | undefined>)
      .VITE_DAILY_RECORD_AUTHORITY_CALLABLE;
  });

  it('defaults to client_only when no rollout flag is configured', () => {
    expect(resolveDailyRecordAuthorityMode()).toBe('client_only');
    expect(shouldUseDailyRecordAuthorityCallable()).toBe(false);
    expect(shouldShadowDailyRecordAuthorityCallable()).toBe(false);
  });

  it('supports explicit shadow and enforced rollout modes', () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'shadow';

    expect(resolveDailyRecordAuthorityMode()).toBe('shadow');
    expect(shouldUseDailyRecordAuthorityCallable()).toBe(false);
    expect(shouldShadowDailyRecordAuthorityCallable()).toBe(true);

    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';

    expect(resolveDailyRecordAuthorityMode()).toBe('enforced');
    expect(shouldUseDailyRecordAuthorityCallable()).toBe(true);
    expect(shouldShadowDailyRecordAuthorityCallable()).toBe(false);
  });

  it('keeps the legacy callable flag as enforced compatibility', () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_CALLABLE =
      'true';

    expect(resolveDailyRecordAuthorityMode()).toBe('enforced');
    expect(shouldUseDailyRecordAuthorityCallable()).toBe(true);
  });

  it('falls back safely to client_only for unknown values', () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'surprise';

    expect(resolveDailyRecordAuthorityMode()).toBe('client_only');
  });
});
