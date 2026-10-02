// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/application/ports/dailyRecordPort');

const moduleCases = [
  {
    name: 'read',
    path: '@/services/repositories/dailyRecordRepositoryReadService',
    method: 'getForDate',
    call: (port: typeof import('@/application/ports/dailyRecordPort')) =>
      port.defaultDailyRecordReadPort.getForDate('2026-04-10'),
    args: ['2026-04-10'],
  },
  {
    name: 'initialization',
    path: '@/services/repositories/dailyRecordRepositoryInitializationService',
    method: 'initializeDay',
    call: (port: typeof import('@/application/ports/dailyRecordPort')) =>
      port.defaultDailyRecordReadPort.initializeDay('2026-04-10', '2026-04-09'),
    args: ['2026-04-10', '2026-04-09'],
  },
  {
    name: 'write',
    path: '@/services/repositories/dailyRecordRepositoryWriteService',
    method: 'updatePartialDetailed',
    call: (port: typeof import('@/application/ports/dailyRecordPort')) =>
      port.defaultDailyRecordRepositoryPort.updatePartialDetailed(
        '2026-04-10',
        { 'beds.R1.pathology': 'Synthetic update' },
        { requireConfirmedRecord: true, requireRemoteAuthorityFirst: true, requireAtomicCas: true }
      ),
    args: [
      '2026-04-10',
      { 'beds.R1.pathology': 'Synthetic update' },
      { requireConfirmedRecord: true, requireRemoteAuthorityFirst: true, requireAtomicCas: true },
    ],
  },
  {
    name: 'sync',
    path: '@/services/repositories/dailyRecordRepositorySyncService',
    method: 'syncWithFirestoreDetailed',
    call: (port: typeof import('@/application/ports/dailyRecordPort')) =>
      port.defaultDailyRecordSyncPort.syncWithFirestoreDetailed('2026-04-10'),
    args: ['2026-04-10'],
  },
  {
    name: 'delete',
    path: '@/services/repositories/dailyRecordRepositoryFacadeSupport',
    method: 'deleteDailyRecordAcrossStores',
    call: (port: typeof import('@/application/ports/dailyRecordPort')) =>
      port.defaultDailyRecordRepositoryPort.deleteDay('2026-04-10'),
    args: ['2026-04-10'],
  },
];

const resetLoaders = () => {
  vi.resetModules();
  for (const { path } of moduleCases) vi.doUnmock(path);
};

describe('daily record port module recovery', () => {
  beforeEach(resetLoaders);
  afterEach(resetLoaders);

  it.each(moduleCases)(
    'allows a later explicit $name call after a module load failure',
    async item => {
      const loadFailed = vi.fn(() => {
        throw new Error('module unavailable');
      });
      vi.doMock(item.path, loadFailed);
      const port = await import('@/application/ports/dailyRecordPort');

      await expect(item.call(port)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: 'module unavailable' }),
      });
      expect(loadFailed).toHaveBeenCalledTimes(1);

      // The loader becomes available; keep the same port instance to test retained rejection.
      const operation = vi.fn().mockResolvedValue(null);
      vi.doMock(item.path, () => ({ [item.method]: operation }));
      await expect(item.call(port)).resolves.toBeNull();
      expect(operation).toHaveBeenCalledExactlyOnceWith(...item.args);
    }
  );

  it('propagates a write failure without automatically repeating the operation', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('write refused'));
    vi.doMock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
      updatePartialDetailed: operation,
    }));
    const port = await import('@/application/ports/dailyRecordPort');
    const item = moduleCases[2];

    await expect(item.call(port)).rejects.toThrow('write refused');
    expect(operation).toHaveBeenCalledExactlyOnceWith(...item.args);
  });
});
