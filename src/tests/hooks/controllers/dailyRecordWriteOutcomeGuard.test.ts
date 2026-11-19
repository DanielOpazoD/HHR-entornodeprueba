// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertDailyRecordWriteAccepted,
  DailyRecordWriteBlockedOutcomeError,
} from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

const DATE = '2026-02-18';

describe('dailyRecordWriteOutcomeGuard', () => {
  it.each<DailyRecordWriteResult>([
    { date: DATE, savedHere: true, state: 'confirmed', localCopy: 'current' },
    { date: DATE, savedHere: true, state: 'local', cause: 'retrying' },
    { date: DATE, savedHere: true, state: 'local', cause: 'merged' },
  ])('lets the census flow continue after $state ($cause$localCopy)', result => {
    expect(() => assertDailyRecordWriteAccepted(result)).not.toThrow();
  });

  it('rejects a blocked write with its own message', () => {
    const result: DailyRecordWriteResult = {
      date: DATE,
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
    };

    expect(() => assertDailyRecordWriteAccepted(result)).toThrow(
      new DailyRecordWriteBlockedOutcomeError(result)
    );
    expect(() => assertDailyRecordWriteAccepted(result)).toThrow(
      'No se encontró un registro local válido para aplicar el cambio.'
    );
  });

  it('rejects an unrecoverable result instead of reporting a successful mutation', () => {
    const result: DailyRecordWriteResult = {
      date: DATE,
      savedHere: false,
      state: 'not_saved',
      reason: 'local_failed',
      userSafeMessage: 'La persistencia local no pudo confirmarse.',
    };

    expect(() => assertDailyRecordWriteAccepted(result)).toThrow(
      DailyRecordWriteBlockedOutcomeError
    );
  });
});
