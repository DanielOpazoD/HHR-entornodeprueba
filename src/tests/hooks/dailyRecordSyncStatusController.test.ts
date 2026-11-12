import { describe, expect, it } from 'vitest';
import {
  resolveDailyRecordSyncStatus,
  type DailyRecordMutationFlags,
} from '@/hooks/controllers/dailyRecordSyncStatusController';
import { createSaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const settled = (local: boolean, remote: boolean): DailyRecordMutationFlags => ({
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
    }),
  },
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
  ] as const)('%s', (_name, mutations, expected) => {
    expect(resolveDailyRecordSyncStatus(mutations)).toBe(expected);
  });
});
