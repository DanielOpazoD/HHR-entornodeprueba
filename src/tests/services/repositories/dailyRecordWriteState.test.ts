// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  buildBlockedWriteResult,
  pendingWriteOutcome,
  sessionEndedWriteOutcome,
  settleWriteResult,
  startWriteResult,
  unrecoverableWriteOutcome,
} from '@/services/repositories/dailyRecordWriteState';

const DATE = '2026-04-16';

const started = startWriteResult(DATE);
const stored: DailyRecordWriteResult = { ...started, savedHere: true };
const confirmed: DailyRecordWriteResult = {
  ...stored,
  state: 'confirmed',
  localCopy: 'current',
};

/** What a caller reads from the result: whether a copy stayed here, and the write's state. */
const seen = (result: DailyRecordWriteResult) => {
  const { savedHere } = result;
  if (result.state === 'confirmed') return [savedHere, result.state, result.localCopy];
  if (result.state === 'local') return [savedHere, result.state, result.cause];
  return [savedHere, result.state, result.reason];
};

describe('dailyRecordWriteState', () => {
  it('starts with nothing stored', () => {
    expect(seen(started)).toEqual([false, 'local', 'stored']);
  });

  it.each<
    [string, DailyRecordWriteResult, (current: DailyRecordWriteResult) => unknown, unknown[]]
  >([
    [
      'queued for an automatic retry',
      stored,
      c => pendingWriteOutcome(c, 'retrying'),
      [true, 'local', 'retrying'],
    ],
    [
      'merged with the remote copy',
      stored,
      c => pendingWriteOutcome(c, 'merged'),
      [true, 'local', 'merged'],
    ],
    [
      'queued after the server took it',
      confirmed,
      c => pendingWriteOutcome(c, 'retrying'),
      [true, 'confirmed', 'current'],
    ],
    ['kept here for review', stored, unrecoverableWriteOutcome, [true, 'held', 'needs_review']],
    [
      'unrecoverable after the server took it',
      confirmed,
      unrecoverableWriteOutcome,
      [true, 'confirmed', 'stale'],
    ],
    [
      'lost before any copy',
      started,
      unrecoverableWriteOutcome,
      [false, 'not_saved', 'local_failed'],
    ],
    [
      'kept for its author when the session ended',
      stored,
      sessionEndedWriteOutcome,
      [true, 'held', 'session_changed'],
    ],
    [
      'kept for its author after the server took it',
      confirmed,
      sessionEndedWriteOutcome,
      [true, 'held', 'session_changed'],
    ],
    [
      'never stored when the session ended first',
      started,
      sessionEndedWriteOutcome,
      [false, 'not_saved', 'session_changed'],
    ],
  ])('a write %s settles in one state', (_, current, outcome, expected) => {
    expect(
      seen(settleWriteResult(current, outcome(current) as Parameters<typeof settleWriteResult>[1]))
    ).toEqual(expected);
  });

  it('replaces the message, error and conflict mark only with a decision', () => {
    const blockingError = new Error('conflicto sintetico');
    const decided = settleWriteResult(
      { ...confirmed, confirmedRecord: { date: DATE } as never },
      { state: 'held', reason: 'needs_review' },
      { userSafeMessage: 'revisar', blockingError, concurrencyConflict: true }
    );
    expect(decided).toMatchObject({
      state: 'held',
      reason: 'needs_review',
      userSafeMessage: 'revisar',
      blockingError,
      concurrencyConflict: true,
      confirmedRecord: { date: DATE },
    });
    expect(decided).not.toHaveProperty('localCopy');

    const kept = settleWriteResult(decided, { state: 'held', reason: 'session_changed' });
    expect(kept).toMatchObject({ userSafeMessage: 'revisar', concurrencyConflict: true });

    const cleared = settleWriteResult(decided, { state: 'local', cause: 'retrying' }, {});
    expect(cleared).not.toHaveProperty('concurrencyConflict');
    expect(cleared.blockingError).toBeUndefined();
    expect(cleared).not.toHaveProperty('reason');
  });

  it('builds a blocked result with no copy anywhere and the producer error', () => {
    const blockingError = new Error('Regla clinica invalida');

    expect(buildBlockedWriteResult(DATE, 'Regla clinica invalida', blockingError)).toEqual({
      date: DATE,
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'Regla clinica invalida',
      blockingError,
    });
  });
});
