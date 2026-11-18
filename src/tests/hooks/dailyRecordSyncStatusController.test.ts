import { describe, expect, it } from 'vitest';
import {
  resolveDailyRecordSyncStatus,
  type DailyRecordMutationFlags,
} from '@/hooks/controllers/dailyRecordSyncStatusController';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

const date = '2026-11-11';
const settled = (result: DailyRecordWriteResult): DailyRecordMutationFlags => ({
  isPending: false,
  isError: false,
  isSuccess: true,
  data: { result },
});
const confirmed = (savedHere: boolean) =>
  settled({ date, savedHere, state: 'confirmed', localCopy: 'current' });
const stored = (savedHere: boolean) =>
  settled({ date, savedHere, state: 'local', cause: 'stored' });
// What the producers return (W16-SR1): a whole day merged and stored here with its task, and
// an edit whose session ended during its direct send, kept here for its author.
const mergedHere = settled({ date, savedHere: true, state: 'local', cause: 'merged' });
const keptForAuthor = settled({ date, savedHere: true, state: 'held', reason: 'session_changed' });
const idle = { isPending: false, isError: false, isSuccess: false };
const failed = { ...idle, isError: true };
const pending = { ...idle, isPending: true };

describe('resolveDailyRecordSyncStatus', () => {
  it.each([
    ['pending precedes failure', [failed, pending], 'saving'],
    ['failure precedes confirmation', [failed, confirmed(true)], 'error'],
    ['confirmed', [idle, confirmed(true)], 'saved'],
    ['inactive', [idle, idle], 'idle'],
    ['returned failure', [stored(false)], 'error'],
    ['local only', [stored(true)], 'local'],
    ['remote only', [confirmed(false)], 'saved'],
    ['legacy without evidence', [{ ...idle, isSuccess: true }], 'idle'],
    ['local remains unconfirmed', [confirmed(true), stored(true)], 'local'],
    ['merged and stored here', [mergedHere], 'local'],
    ['session ended during the send: kept for its author', [keptForAuthor], 'local'],
  ] as const)('%s', (_name, mutations, expected) => {
    expect(resolveDailyRecordSyncStatus(mutations)).toBe(expected);
  });
});
