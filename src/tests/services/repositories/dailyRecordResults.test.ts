// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isDailyRecordWriteRejectedResult,
  toDailyRecordWriteError,
  type DailyRecordWriteResult,
} from '@/services/repositories/contracts/dailyRecordResults';

const date = '2026-02-19';

describe('dailyRecordResults contracts', () => {
  it.each<[DailyRecordWriteResult, boolean]>([
    [{ date, savedHere: true, state: 'confirmed', localCopy: 'current' }, false],
    [{ date, savedHere: false, state: 'confirmed', localCopy: 'stale' }, true],
    [{ date, savedHere: true, state: 'local', cause: 'retrying' }, false],
    [{ date, savedHere: true, state: 'held', reason: 'field_changed_elsewhere' }, false],
    [{ date, savedHere: true, state: 'held', reason: 'session_changed' }, false],
    [{ date, savedHere: true, state: 'held', reason: 'needs_review' }, true],
    [{ date, savedHere: false, state: 'not_saved', reason: 'blocked' }, true],
  ])('a write that left %o is rejected: %s', (result, rejected) => {
    expect(isDailyRecordWriteRejectedResult(result)).toBe(rejected);
  });

  it('turns a conflict with another writer into a ConcurrencyError, keeping a producer class', () => {
    const conflict: DailyRecordWriteResult = {
      date,
      savedHere: false,
      state: 'not_saved',
      reason: 'local_failed',
      concurrencyConflict: true,
      userSafeMessage: 'El día cambió en otro equipo.',
    };
    const ownClass = Object.assign(new Error('versión'), { name: 'VersionMismatchError' });

    expect(toDailyRecordWriteError(conflict, 'fallback')).toMatchObject({
      name: 'ConcurrencyError',
      message: 'El día cambió en otro equipo.',
    });
    expect(toDailyRecordWriteError({ ...conflict, blockingError: ownClass }, 'fallback')).toBe(
      ownClass
    );
    expect(
      toDailyRecordWriteError({ ...conflict, concurrencyConflict: undefined }, 'fallback').name
    ).toBe('Error');
  });
});
