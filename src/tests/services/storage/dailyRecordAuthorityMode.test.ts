import { beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyRecordAuthorityMode } from '@/services/storage/firestore/dailyRecordAuthorityMode';

describe('dailyRecordAuthorityMode', () => {
  beforeEach(() => {
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    delete (import.meta.env as Record<string, string | undefined>)
      .VITE_DAILY_RECORD_AUTHORITY_CALLABLE;
  });

  it('defaults to client_only when no rollout flag is configured', () => {
    expect(resolveDailyRecordAuthorityMode()).toBe('client_only');
  });

  it.each(['client_only', 'enforced'] as const)('supports explicit %s mode', mode => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE = mode;
    expect(resolveDailyRecordAuthorityMode()).toBe(mode);
  });

  it('keeps the legacy callable flag as enforced compatibility', () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_CALLABLE =
      'true';

    expect(resolveDailyRecordAuthorityMode()).toBe('enforced');
  });

  it.each(['shadow', 'surprise'])('treats retired or unknown mode %s as undefined', mode => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE = mode;

    expect(resolveDailyRecordAuthorityMode()).toBe('client_only');
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_CALLABLE =
      'true';
    expect(resolveDailyRecordAuthorityMode()).toBe('enforced');
  });
});
