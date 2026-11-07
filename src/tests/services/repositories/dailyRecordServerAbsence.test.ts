import { setImmediate } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const server = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/services/storage/firestore/firestoreServerDocumentRead', () => ({
  readFirestoreDocumentFromServer: server.read,
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: (date: string) => ({
    firestore: 'synthetic-db',
    path: `hospitals/hanga_roa/dailyRecords/${date}`,
  }),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestoreDetailed: vi.fn(),
  subscribeToRecord: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/indexeddb/indexedDbRecordService')>()),
  getRecordForDate: vi.fn(async () => null),
  captureLocalRecordBase: vi.fn(async () => ({ kind: 'missing' })),
}));
vi.mock('@/services/storage/sync/dailyRecordSyncQueueReadService', () => ({
  getPendingDailyRecordProjection: vi.fn(async () => null),
}));

import { confirmDailyRecordMissingOnServer } from '@/services/repositories/dailyRecordServerAbsence';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import { dailyRecordSyncLogger } from '@/services/repositories/repositoryLoggers';
import {
  getRecordFromFirestoreDetailed,
  subscribeToRecord,
} from '@/services/storage/firestore/firestoreRecordQueries';

const date = '2026-11-06';
const fromServer = { fromCache: false, hasPendingWrites: false };
const serverHasTheDay = () => server.read.mockResolvedValue({});
const serverLacksTheDay = () => server.read.mockResolvedValue(null);

describe('a day reported missing is confirmed with the server before it can be created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dailyRecordSyncLogger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(dailyRecordObservability, 'recordEvent').mockImplementation(() => undefined);
  });

  it('asks the server only whether the day exists, not for its contents', async () => {
    serverLacksTheDay();
    await expect(confirmDailyRecordMissingOnServer(date)).resolves.toBeUndefined();
    expect(server.read).toHaveBeenCalledWith(
      'synthetic-db',
      'hospitals/hanga_roa/dailyRecords/2026-11-06',
      ['date']
    );
  });

  it('turns «missing» into a failed read when the server still has the day', async () => {
    serverHasTheDay();
    await expect(confirmDailyRecordMissingOnServer(date)).rejects.toThrow(/server still has it/);
    expect(dailyRecordObservability.recordEvent).toHaveBeenCalledWith(
      'server_contradicted_missing_record',
      'degraded',
      expect.objectContaining({ date, runtimeState: 'blocked' })
    );
  });

  it('keeps the SDK answer when the check cannot answer, so a new day can still start', async () => {
    server.read.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(confirmDailyRecordMissingOnServer(date)).resolves.toBeUndefined();
  });

  it('confirms nothing with an answer from the previous person’s session', async () => {
    server.read.mockRejectedValue(Object.assign(new Error('changed'), { code: 'cancelled' }));
    await expect(confirmDailyRecordMissingOnServer(date)).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  describe('point read', () => {
    beforeEach(() => {
      vi.mocked(getRecordFromFirestoreDetailed).mockResolvedValue({
        status: 'missing',
        serverConfirmed: true,
        record: null,
      });
    });

    it('fails instead of reporting the day missing when the server has it', async () => {
      serverHasTheDay();
      await expect(loadRemoteRecordWithFallback(date)).rejects.toThrow(/server still has it/);
    });

    it('reports the day missing when the server agrees', async () => {
      serverLacksTheDay();
      await expect(loadRemoteRecordWithFallback(date)).resolves.toMatchObject({
        record: null,
        source: 'not_found',
        serverConfirmed: true,
      });
    });

    it('does not ask the server again when the SDK answer was only from the cache', async () => {
      vi.mocked(getRecordFromFirestoreDetailed).mockResolvedValue({
        status: 'missing',
        serverConfirmed: false,
        record: null,
      });
      await loadRemoteRecordWithFallback(date);
      expect(server.read).not.toHaveBeenCalled();
    });
  });

  describe('realtime listener', () => {
    const listen = () => {
      const onResult = vi.fn<(result: SyncDailyRecordResult, pending: boolean) => void>();
      const onFailure = vi.fn<(result: SyncDailyRecordResult) => void>();
      vi.mocked(subscribeToRecord).mockReturnValue(() => undefined);
      const stop = subscribeDetailed(date, onResult, onFailure);
      const next = vi.mocked(subscribeToRecord).mock.calls.at(-1)![1];
      return { next, onResult, onFailure, stop };
    };

    it('reports a failed read, never an empty day, when the server has the day', async () => {
      serverHasTheDay();
      const { next, onResult, onFailure, stop } = listen();
      next(null, false, fromServer);
      await setImmediate();
      stop();

      expect(onResult).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'blocked', record: null, serverConfirmed: false })
      );
    });

    it('reports the day missing when the server agrees', async () => {
      serverLacksTheDay();
      const { next, onResult, onFailure, stop } = listen();
      next(null, false, fromServer);
      await setImmediate();
      stop();

      expect(onFailure).not.toHaveBeenCalled();
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'missing', serverConfirmed: true, record: null }),
        false
      );
    });
  });
});
