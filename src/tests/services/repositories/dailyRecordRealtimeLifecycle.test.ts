import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/indexeddb/indexedDbRecordService')>()),
  getRecordForDate: vi.fn(),
  saveRecordStrict: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: vi.fn(),
}));

vi.mock('@/services/storage/sync/dailyRecordSyncQueueReadService', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/services/storage/sync/dailyRecordSyncQueueReadService')
  >()),
  getPendingDailyRecordProjection: vi.fn(),
}));

vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: vi.fn(),
}));

import { DataFactory } from '@/tests/factories/DataFactory';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  getRecordForDate,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';
import { getPendingDailyRecordProjection } from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { dailyRecordSyncLogger } from '@/services/repositories/repositoryLoggers';

const date = '2026-10-29';
const confirmedMetadata = { fromCache: false, hasPendingWrites: false };
const privateConsumerDetail = 'Synthetic private consumer detail';
const blockedFailure = {
  date,
  outcome: 'blocked',
  consistencyState: 'blocked',
  record: null,
  serverConfirmed: false,
  retryability: 'manual_retry',
};

const recordFor = (revision: 'A' | 'B'): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: revision === 'A' ? '2026-10-29T12:00:00.000Z' : '2026-10-29T12:01:00.000Z',
    nursesDayShift: [`SYNTHETIC ${revision}`],
  });

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise has not initialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('Deferred promise has not initialized');
  };
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('daily record realtime subscription lifecycle', () => {
  const stops: Array<() => void> = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecordForDate).mockReset().mockResolvedValue(null);
    vi.mocked(saveRecordStrict)
      .mockReset()
      .mockImplementation(async record => ({
        ok: true,
        operation: 'save',
        store: 'indexeddb',
        dates: [record.date],
      }));
    vi.mocked(getPendingDailyRecordProjection).mockReset().mockResolvedValue(null);
    vi.mocked(loadRemoteRecordWithFallback)
      .mockReset()
      .mockRejectedValue(new Error('Unexpected remote fallback IO'));
    vi.mocked(subscribeToRecord)
      .mockReset()
      .mockReturnValue(() => undefined);
    vi.spyOn(dailyRecordSyncLogger, 'warn').mockImplementation(() => undefined);
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop();
    await setImmediate();
    process.off('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
    expect(unhandled).toEqual([]);
  });

  const listener = () => {
    const call = vi.mocked(subscribeToRecord).mock.calls.at(-1);
    if (!call || !call[2]) throw new Error('Repository did not expose a listener error callback');
    return { next: call[1], error: call[2] };
  };

  const start = () => {
    const onResult = vi.fn<(result: SyncDailyRecordResult, pending: boolean) => void>();
    const onFailure = vi.fn<(result: SyncDailyRecordResult) => void>();
    const stop = subscribeDetailed(date, onResult, onFailure);
    stops.push(stop);
    return { ...listener(), onResult, onFailure, stop };
  };

  const expectSafeDiagnostic = () => {
    const warnings = vi.mocked(dailyRecordSyncLogger.warn).mock.calls;
    expect(warnings.length).toBeGreaterThan(0);
    for (const [message, ...details] of warnings) {
      expect(message).not.toContain(privateConsumerDetail);
      expect(details).toEqual([{ date, stage: expect.stringMatching(/^(consumer|resolution)$/) }]);
    }
  };

  it('invalidates an older local read on SDK failure without late hydration or delivery', async () => {
    const localRead = deferred<DailyRecord | null>();
    vi.mocked(getRecordForDate).mockReturnValueOnce(localRead.promise);
    const { next, error, onResult, onFailure } = start();

    next(recordFor('A'), false, confirmedMetadata);
    error(new Error('Synthetic SDK failure'));
    expect(onFailure.mock.calls).toEqual([[expect.objectContaining(blockedFailure)]]);
    localRead.resolve(null);
    await setImmediate();

    expect(onResult.mock.calls).toEqual([]);
    expect(onFailure.mock.calls).toEqual([[expect.objectContaining(blockedFailure)]]);
    expect(saveRecordStrict).not.toHaveBeenCalled();
    expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();
  });

  it('delivers and hydrates only B when A and B local reads finish backwards', async () => {
    const readA = deferred<DailyRecord | null>();
    const readB = deferred<DailyRecord | null>();
    vi.mocked(getRecordForDate)
      .mockReturnValueOnce(readA.promise)
      .mockReturnValueOnce(readB.promise);
    const { next, onResult, onFailure } = start();

    next(recordFor('A'), false, confirmedMetadata);
    next(recordFor('B'), false, confirmedMetadata);
    readB.resolve(null);
    await setImmediate();
    readA.resolve(null);
    await setImmediate();

    expect(onResult.mock.calls).toEqual([
      [
        expect.objectContaining({
          outcome: 'clean',
          serverConfirmed: true,
          record: expect.objectContaining({ nursesDayShift: ['SYNTHETIC B'] }),
        }),
        false,
      ],
    ]);
    expect(vi.mocked(saveRecordStrict).mock.calls).toEqual([
      [
        expect.objectContaining({ nursesDayShift: ['SYNTHETIC B'] }),
        { preserveUnresolvedWrites: true },
      ],
    ]);
    expect(onFailure.mock.calls).toEqual([]);
  });

  it('ignores an obsolete read rejection after B has been delivered', async () => {
    const readA = deferred<DailyRecord | null>();
    vi.mocked(getRecordForDate).mockReturnValueOnce(readA.promise);
    const { next, onResult, onFailure } = start();
    next(recordFor('A'), false, confirmedMetadata);
    next(recordFor('B'), false, confirmedMetadata);
    await setImmediate();
    readA.reject(new Error('Synthetic obsolete read failure'));
    await setImmediate();

    expect(onResult.mock.calls).toEqual([
      [
        expect.objectContaining({
          record: expect.objectContaining({ nursesDayShift: ['SYNTHETIC B'] }),
        }),
        false,
      ],
    ]);
    expect(onFailure.mock.calls).toEqual([]);
  });

  it('reports SDK failure without attempting any storage or fallback IO', async () => {
    const { error, onResult, onFailure } = start();
    error(new Error('Synthetic terminal SDK failure'));
    await setImmediate();

    expect(onResult.mock.calls).toEqual([]);
    expect(onFailure.mock.calls).toEqual([[expect.objectContaining(blockedFailure)]]);
    expect(getRecordForDate).not.toHaveBeenCalled();
    expect(saveRecordStrict).not.toHaveBeenCalled();
    expect(getPendingDailyRecordProjection).not.toHaveBeenCalled();
    expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();
  });

  it.each(['local read', 'hydration', 'pending projection'])(
    'contains a rejected %s and accepts a later valid snapshot without recursive IO fallback',
    async stage => {
      const failure = deferred<never>();
      if (stage === 'local read') {
        vi.mocked(getRecordForDate).mockReturnValueOnce(failure.promise);
      } else if (stage === 'hydration') {
        vi.mocked(saveRecordStrict).mockReturnValueOnce(failure.promise);
      } else {
        vi.mocked(getPendingDailyRecordProjection).mockReturnValueOnce(failure.promise);
      }
      const { next, onResult, onFailure } = start();
      next(recordFor('A'), false, confirmedMetadata);
      await setImmediate();
      failure.reject(new Error(`Synthetic ${stage} failure`));
      await setImmediate();

      expect(onResult.mock.calls).toEqual([]);
      expect(onFailure.mock.calls).toEqual([[expect.objectContaining(blockedFailure)]]);
      expect(getRecordForDate).toHaveBeenCalledTimes(1);
      expect(saveRecordStrict).toHaveBeenCalledTimes(stage === 'local read' ? 0 : 1);
      expect(getPendingDailyRecordProjection).toHaveBeenCalledTimes(
        stage === 'pending projection' ? 1 : 0
      );
      expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();

      next(recordFor('B'), false, confirmedMetadata);
      await setImmediate();
      expect(onResult.mock.calls).toEqual([
        [
          expect.objectContaining({
            outcome: 'clean',
            serverConfirmed: true,
            record: expect.objectContaining({ nursesDayShift: ['SYNTHETIC B'] }),
          }),
          false,
        ],
      ]);
      expect(onFailure.mock.calls).toEqual([[expect.objectContaining(blockedFailure)]]);
    }
  );

  it.each(['resolve', 'reject'])(
    'stops before a local read can %s or a listener can fail',
    async settlement => {
      const localRead = deferred<DailyRecord | null>();
      vi.mocked(getRecordForDate).mockReturnValueOnce(localRead.promise);
      const { next, error, stop, onResult, onFailure } = start();
      next(recordFor('A'), false, confirmedMetadata);
      stop();
      error(new Error('Synthetic error after stop'));
      if (settlement === 'resolve') localRead.resolve(null);
      else localRead.reject(new Error('Synthetic read failure after stop'));
      await setImmediate();

      expect(onResult.mock.calls).toEqual([]);
      expect(onFailure.mock.calls).toEqual([]);
      expect(saveRecordStrict).not.toHaveBeenCalled();
      expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();
    }
  );

  it('diagnoses a throwing result consumer without converting it to a subscription failure', async () => {
    const { next, onResult, onFailure } = start();
    onResult.mockImplementation(() => {
      throw new Error(privateConsumerDetail);
    });
    next(recordFor('A'), false, confirmedMetadata);
    await setImmediate();

    expect(onResult.mock.calls).toEqual([
      [expect.objectContaining({ outcome: 'clean', serverConfirmed: true }), false],
    ]);
    expect(onFailure.mock.calls).toEqual([]);
    expectSafeDiagnostic();
    expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();
  });

  it.each(['SDK', 'resolution'])(
    'contains a throwing failure consumer after %s failure',
    async source => {
      const { next, error, onResult, onFailure } = start();
      onFailure.mockImplementation(() => {
        throw new Error(privateConsumerDetail);
      });
      if (source === 'SDK') error(new Error('Synthetic SDK failure'));
      else {
        vi.mocked(getRecordForDate).mockRejectedValueOnce(new Error('Synthetic read failure'));
        next(recordFor('A'), false, confirmedMetadata);
      }
      await setImmediate();

      expect(onResult.mock.calls).toEqual([]);
      expect(onFailure.mock.calls).toEqual([[expect.objectContaining(blockedFailure)]]);
      expectSafeDiagnostic();
      expect(loadRemoteRecordWithFallback).not.toHaveBeenCalled();
    }
  );
});
