import { describe, expect, it } from 'vitest';
import {
  resolveDailyRecordSyncStatus,
  type DailyRecordMutationFlags,
} from '@/hooks/controllers/dailyRecordSyncStatusController';
import {
  createSaveDailyRecordResult,
  type SaveDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

const settled = (
  local: boolean,
  remote: boolean,
  shape: Partial<SaveDailyRecordResult> = {}
): DailyRecordMutationFlags => ({
  isPending: false,
  isError: false,
  isSuccess: true,
  data: {
    result: createSaveDailyRecordResult({
      date: '2026-11-11',
      outcome: 'clean',
      savedLocally: local,
      savedRemotely: remote,
      queuedForRetry: false,
      autoMerged: false,
      ...shape,
    }),
  },
});
// What the producers return (W16-SR1): a whole day merged and stored here with its task, and
// an edit whose session ended during its direct send, kept here for its author.
const mergedHere = settled(true, false, {
  outcome: 'auto_merged',
  autoMerged: true,
  queuedForRetry: true,
});
const keptForAuthor = settled(true, false, {
  outcome: 'queued',
  queuedForRetry: true,
  reason: 'session_changed',
});
const idle = { isPending: false, isError: false, isSuccess: false };
const failed = { ...idle, isError: true };
const pending = { ...idle, isPending: true };

describe('resolveDailyRecordSyncStatus', () => {
  it.each([
    ['pending precedes failure', [failed, pending], 'saving'],
    ['failure precedes confirmation', [failed, settled(true, true)], 'error'],
    ['confirmed', [idle, settled(true, true)], 'saved'],
    ['inactive', [idle, idle], 'idle'],
    ['returned failure', [settled(false, false)], 'error'],
    ['local only', [settled(true, false)], 'local'],
    ['remote only', [settled(false, true)], 'saved'],
    ['legacy without evidence', [{ ...idle, isSuccess: true }], 'idle'],
    ['local remains unconfirmed', [settled(true, true), settled(true, false)], 'local'],
    ['merged and stored here', [mergedHere], 'local'],
    ['session ended during the send: kept for its author', [keptForAuthor], 'local'],
  ] as const)('%s', (_name, mutations, expected) => {
    expect(resolveDailyRecordSyncStatus(mutations)).toBe(expected);
  });
});
