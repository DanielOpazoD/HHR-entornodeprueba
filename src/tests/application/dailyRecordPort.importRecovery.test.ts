import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.unmock('@/application/ports/dailyRecordPort');

const record = DataFactory.createMockDailyRecord('2026-11-10');

describe('daily record port import recovery', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock('@/services/repositories/dailyRecordRepositoryWriteService'));

  it('rejects the failed saves and loads again only on the next save', async () => {
    let loads = 0;
    const saveDetailed = vi.fn().mockResolvedValue({ outcome: 'saved' });
    vi.doMock('@/services/repositories/dailyRecordRepositoryWriteService', () => {
      loads += 1;
      if (loads === 1) throw new Error('synthetic chunk load failure');
      return { saveDetailed };
    });
    const { defaultDailyRecordWritePort: port } =
      await import('@/application/ports/dailyRecordPort');
    const failed = await Promise.allSettled([port.save(record), port.save(record)]);
    expect(failed).toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({
          cause: expect.objectContaining({ message: 'synthetic chunk load failure' }),
        }),
      },
      {
        status: 'rejected',
        reason: expect.objectContaining({
          cause: expect.objectContaining({ message: 'synthetic chunk load failure' }),
        }),
      },
    ]);
    expect(loads).toBe(1);
    expect(saveDetailed).not.toHaveBeenCalled();

    await expect(port.save(record)).resolves.toEqual({ outcome: 'saved' });
    expect(loads).toBe(2);
    expect(saveDetailed).toHaveBeenCalledExactlyOnceWith(record, undefined);
  });

  it('keeps a successful load shared for concurrent and later saves', async () => {
    let loads = 0;
    const saveDetailed = vi.fn().mockResolvedValue({ outcome: 'saved' });
    vi.doMock('@/services/repositories/dailyRecordRepositoryWriteService', () => {
      loads += 1;
      return { saveDetailed };
    });
    const { defaultDailyRecordWritePort: port } =
      await import('@/application/ports/dailyRecordPort');
    expect(await Promise.all([port.save(record), port.save(record)])).toEqual([
      { outcome: 'saved' },
      { outcome: 'saved' },
    ]);
    await expect(port.save(record)).resolves.toEqual({ outcome: 'saved' });
    expect(loads).toBe(1);
    expect(saveDetailed).toHaveBeenCalledTimes(3);
  });
});
