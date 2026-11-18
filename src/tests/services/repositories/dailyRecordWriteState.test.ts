// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildBlockedWriteResult,
  buildWriteResult,
  createRemoteWriteState,
  type RemoteWriteState,
} from '@/services/repositories/dailyRecordWriteState';

const DATE = '2026-04-16';

const stateWith = (changes: Partial<RemoteWriteState>): RemoteWriteState => ({
  ...createRemoteWriteState(),
  ...changes,
});

/** What a caller reads from the result: whether a copy stayed here, and the write's state. */
const seen = (state: RemoteWriteState) => {
  const result = buildWriteResult(DATE, state);
  const { savedHere } = result;
  if (result.state === 'confirmed') return [savedHere, result.state, result.localCopy];
  if (result.state === 'local') return [savedHere, result.state, result.cause];
  return [savedHere, result.state, result.reason];
};

describe('dailyRecordWriteState', () => {
  it.each<[string, Partial<RemoteWriteState>, unknown[]]>([
    ['stored with no server', { savedLocally: true }, [true, 'local', 'stored']],
    [
      'confirmed by the server',
      { savedLocally: true, savedRemotely: true, consistencyState: 'persisted_and_synced' },
      [true, 'confirmed', 'current'],
    ],
    [
      'confirmed while this copy could not follow',
      { savedRemotely: true, consistencyState: 'unrecoverable' },
      [false, 'confirmed', 'stale'],
    ],
    [
      'queued for an automatic retry',
      { savedLocally: true, queuedForRetry: true, consistencyState: 'queued_for_retry' },
      [true, 'local', 'retrying'],
    ],
    [
      'merged with the remote copy',
      {
        savedLocally: true,
        queuedForRetry: true,
        autoMerged: true,
        consistencyState: 'auto_merged',
      },
      [true, 'local', 'merged'],
    ],
    [
      'kept here for review',
      { savedLocally: true, consistencyState: 'unrecoverable' },
      [true, 'held', 'needs_review'],
    ],
    [
      'merged and then found unrecoverable',
      { savedLocally: true, autoMerged: true, consistencyState: 'unrecoverable' },
      [true, 'held', 'needs_review'],
    ],
    [
      'lost before any copy',
      { consistencyState: 'unrecoverable' },
      [false, 'not_saved', 'local_failed'],
    ],
    [
      'blocked by a remote integrity check',
      { savedLocally: true, consistencyState: 'blocked_version_mismatch' },
      [true, 'not_saved', 'blocked'],
    ],
    [
      'blocked by validation',
      { savedLocally: true, consistencyState: 'blocked_validation' },
      [true, 'not_saved', 'blocked'],
    ],
    [
      'routed to the day queue task',
      { savedLocally: true, queuedForRetry: true, reason: 'queue_route' },
      [true, 'local', 'queue_route'],
    ],
    [
      'held because the field changed elsewhere',
      {
        savedLocally: true,
        queuedForRetry: true,
        autoMerged: true,
        consistencyState: 'auto_merged',
        reason: 'field_changed_elsewhere',
      },
      [true, 'held', 'field_changed_elsewhere'],
    ],
    [
      'kept for its author when the session ended',
      { savedLocally: true, queuedForRetry: true, reason: 'session_changed' },
      [true, 'held', 'session_changed'],
    ],
    [
      'never stored when the session ended first',
      { consistencyState: 'unrecoverable', reason: 'session_changed' },
      [false, 'not_saved', 'session_changed'],
    ],
  ])('a write %s leaves its state once', (_, changes, expected) => {
    expect(seen(stateWith(changes))).toEqual(expected);
  });

  it('names a conflict with another writer so its error travels as ConcurrencyError', () => {
    const conflict = stateWith({
      consistencyState: 'unrecoverable',
      conflictSummary: { kind: 'concurrency', sourceOfTruth: 'local' },
    });
    const unavailable = stateWith({
      consistencyState: 'unrecoverable',
      conflictSummary: { kind: 'remote_unavailable', sourceOfTruth: 'local' },
    });

    expect(buildWriteResult(DATE, conflict).concurrencyConflict).toBe(true);
    expect(buildWriteResult(DATE, unavailable)).not.toHaveProperty('concurrencyConflict');
  });

  it('builds a blocked result with no copy anywhere and the producer error', () => {
    const blockingError = new Error('Regla clinica invalida');
    const state = stateWith({
      savedLocally: true,
      consistencyState: 'blocked_validation',
      userSafeMessage: 'Regla clinica invalida',
      blockingError,
    });

    expect(buildBlockedWriteResult(DATE, state)).toEqual({
      date: DATE,
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'Regla clinica invalida',
      blockingError,
    });
  });
});
