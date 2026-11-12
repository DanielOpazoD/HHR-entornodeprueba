import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';
import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));

afterEach(async () => {
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});

describe('authority readback preserves pending edits', () => {
  it.each([false, true])(
    'retains the original read error (remote first: %s)',
    async remoteAuthorityFirst => {
      const record = DataFactory.createMockDailyRecord('2026-04-01');
      await hospitalDB.dailyRecords.put(record);
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-readback',
        key: `daily:${record.date}`,
        type: 'UPDATE_DAILY_RECORD',
        status: 'PENDING',
        payload: record,
        timestamp: 1,
        retryCount: 0,
      });
      const pending = await hospitalDB.syncQueue.toArray();
      const state = createRemoteWriteState();
      const error = new Error('synthetic readback unavailable');
      const ack = vi.fn();
      const result = await persistLocalAndAttemptRemoteSync({
        date: record.date,
        record,
        changedPaths: ['beds.R1.status'],
        remoteState: state,
        remoteWrite: async () => undefined,
        onRemoteFailure: vi.fn(),
        readRemoteConfirmedRecord: async () => {
          throw error;
        },
        remoteAuthorityFirst,
        requireConfirmedRecord: true,
        ackLocalAfterRemote: ack,
        queueLocalBeforeRemote: async () => ({
          accepted: true,
          mode: 'created',
          pendingTasks: 1,
          maxPendingTasks: 10,
        }),
      });
      expect(result).toBe('return');
      expect(state.confirmedRecord).toBeUndefined();
      expect(state.consistencyState).toBe('unrecoverable');
      expect(ack).not.toHaveBeenCalled();
      expect(await hospitalDB.dailyRecords.get(record.date)).toEqual(record);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(pending);
      expect(state.blockingError).toBe(error);
    }
  );

  it('keeps genuine absence blocked without inventing confirmation', async () => {
    const record = DataFactory.createMockDailyRecord('2026-04-02');
    const state = createRemoteWriteState();
    const result = await persistLocalAndAttemptRemoteSync({
      date: record.date,
      record,
      changedPaths: [],
      remoteState: state,
      remoteWrite: async () => undefined,
      onRemoteFailure: vi.fn(),
      readRemoteConfirmedRecord: async () => null,
      remoteAuthorityFirst: true,
    });
    expect(result).toBe('return');
    expect(state.confirmedRecord).toBeUndefined();
    expect(state.blockingError?.message).toBe(
      'La autoridad remota no devolvió la versión confirmada del registro.'
    );
  });
});
