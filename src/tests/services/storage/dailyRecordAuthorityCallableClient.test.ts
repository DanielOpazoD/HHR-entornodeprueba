import { describe, expect, it } from 'vitest';
import {
  normalizeDailyRecordAuthorityError,
  shouldRetryDailyRecordAuthorityError,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

describe('dailyRecordAuthorityCallableClient', () => {
  it('normalizes an authority revision mismatch as a recoverable concurrency conflict', () => {
    const normalized = normalizeDailyRecordAuthorityError({
      code: 'functions/aborted',
      message: 'revision_mismatch: base revision 38 does not match remote revision 40',
    });

    expect(normalized).toBeInstanceOf(ConcurrencyError);
    expect(normalized).toMatchObject({ name: 'ConcurrencyError' });
    expect(String((normalized as Error).message)).toMatch(/versión más reciente/i);
  });

  it.each(['functions/invalid-argument', 'functions/permission-denied', 'functions/aborted'])(
    'does not retry a deterministic authority rejection (%s)',
    code => {
      expect(shouldRetryDailyRecordAuthorityError({ code })).toBe(false);
    }
  );

  it('keeps transient authority failures retryable', () => {
    expect(shouldRetryDailyRecordAuthorityError({ code: 'functions/unavailable' })).toBe(true);
  });

  it('does not retry a normalized concurrency conflict', () => {
    expect(shouldRetryDailyRecordAuthorityError(new ConcurrencyError('stale'))).toBe(false);
  });
});
