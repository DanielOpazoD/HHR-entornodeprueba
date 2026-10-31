import { describe, expect, it } from 'vitest';
import {
  normalizeDailyRecordAuthorityError,
  shouldRetryDailyRecordAuthorityError,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

describe('dailyRecordAuthorityCallableClient', () => {
  it.each([
    'revision_mismatch: base revision 38 does not match remote revision 40',
    'Daily record changed remotely before the authorized write transaction.',
  ])('normalizes the technical version conflict %s', message => {
    const normalized = normalizeDailyRecordAuthorityError({
      code: 'functions/aborted',
      message,
    });

    expect(normalized).toBeInstanceOf(ConcurrencyError);
    expect(normalized).toMatchObject({ name: 'ConcurrencyError', reason: 'version_mismatch' });
    expect(String((normalized as Error).message)).toMatch(/versión más reciente/i);
  });

  it.each(['Specialty decision changed.', 'Specialty episode changed.'])(
    'retains the semantic classification for %s',
    message => {
      expect(
        normalizeDailyRecordAuthorityError({ code: 'functions/aborted', message })
      ).toMatchObject({ name: 'ConcurrencyError', reason: 'semantic_conflict' });
    }
  );

  it.each(['functions/invalid-argument', 'functions/permission-denied', 'functions/aborted'])(
    'does not retry a deterministic authority rejection (%s)',
    code => {
      expect(shouldRetryDailyRecordAuthorityError({ code })).toBe(false);
    }
  );

  it('keeps transient authority failures retryable', () => {
    expect(shouldRetryDailyRecordAuthorityError({ code: 'functions/unavailable' })).toBe(true);
    expect(shouldRetryDailyRecordAuthorityError({ code: 'functions/internal' })).toBe(true);
  });

  it('does not retry a normalized concurrency conflict', () => {
    expect(shouldRetryDailyRecordAuthorityError(new ConcurrencyError('stale'))).toBe(false);
  });
});

it('keeps a missing authority base as non-retryable validation, never an automatic version rebase', () => {
  const normalized = normalizeDailyRecordAuthorityError({
    code: 'functions/failed-precondition',
    message: 'base_required: An existing daily record requires a verifiable base version.',
  });
  expect(normalized).not.toBeInstanceOf(ConcurrencyError);
  expect(classifySyncError(normalized)).toMatchObject({ category: 'validation', retryable: false });
  expect(shouldRetryDailyRecordAuthorityError(normalized)).toBe(false);
});
