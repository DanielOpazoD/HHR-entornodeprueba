import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

vi.unmock('@/application/ports/dailyRecordPort');
const date = '2026-11-10';
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const loadPort = async () =>
  (await import('@/application/ports/dailyRecordPort')).defaultDailyRecordRepositoryPort;

describe('lazy daily record subscription', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock('@/services/repositories/dailyRecordRepositorySyncService'));

  it('reports a failed load once through the canonical failure channel', async () => {
    vi.doMock('@/services/repositories/dailyRecordRepositorySyncService', () => {
      throw new Error('synthetic chunk load failure');
    });
    const port = await loadPort();
    const callback = vi.fn();
    const onFailure = vi.fn();
    const stop = port.subscribeDetailed(date, callback, onFailure);
    await flush();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      createSyncDailyRecordResult({
        date,
        outcome: 'blocked',
        record: null,
        retryability: 'manual_retry',
      })
    );
    expect(callback).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('forwards the subscription arguments after loading', async () => {
    const subscribeDetailed = vi.fn<
      (typeof import('@/services/repositories/dailyRecordRepositorySyncService'))['subscribeDetailed']
    >(() => vi.fn());
    vi.doMock('@/services/repositories/dailyRecordRepositorySyncService', () => ({
      subscribeDetailed,
    }));
    const port = await loadPort();
    const callback = vi.fn();
    const onFailure = vi.fn();
    port.subscribeDetailed(date, callback, onFailure);
    await flush();
    expect(subscribeDetailed).toHaveBeenCalledWith(
      date,
      expect.any(Function),
      expect.any(Function)
    );
    const result = createSyncDailyRecordResult({ date, outcome: 'clean', record: null });
    subscribeDetailed.mock.calls[0]?.[1]?.(result, false);
    subscribeDetailed.mock.calls[0]?.[2]?.(result);
    expect(callback).toHaveBeenCalledWith(result, false);
    expect(onFailure).toHaveBeenCalledWith(result);
  });

  it('the returned unsubscribe stops an already started subscription', async () => {
    const unsubscribe = vi.fn();
    vi.doMock('@/services/repositories/dailyRecordRepositorySyncService', () => ({
      subscribeDetailed: () => unsubscribe,
    }));
    const port = await loadPort();
    const stop = port.subscribeDetailed(date, vi.fn());
    await flush();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'cancellation before loading suppresses subscription and failure (reject=%s)',
    async reject => {
      const subscribeDetailed = vi.fn();
      vi.doMock('@/services/repositories/dailyRecordRepositorySyncService', () => {
        if (reject) throw new Error('synthetic failure');
        return { subscribeDetailed };
      });
      const port = await loadPort();
      const callback = vi.fn();
      const onFailure = vi.fn();
      port.subscribeDetailed(date, callback, onFailure)();
      await flush();
      expect(subscribeDetailed).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    }
  );

  it('suppresses late data and failure after cancellation', async () => {
    const subscribeDetailed = vi.fn<
      (typeof import('@/services/repositories/dailyRecordRepositorySyncService'))['subscribeDetailed']
    >(() => vi.fn());
    vi.doMock('@/services/repositories/dailyRecordRepositorySyncService', () => ({
      subscribeDetailed,
    }));
    const port = await loadPort();
    const callback = vi.fn();
    const onFailure = vi.fn();
    const stop = port.subscribeDetailed(date, callback, onFailure);
    await flush();
    stop();
    const result = createSyncDailyRecordResult({ date, outcome: 'clean', record: null });
    subscribeDetailed.mock.calls[0]?.[1](result, false);
    subscribeDetailed.mock.calls[0]?.[2]?.(result);
    expect(callback).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
