import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/application/ports/dailyRecordPort');

import {
  defaultDailyRecordReadPort,
  defaultDailyRecordRepositoryPort,
  defaultDailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import { createSyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const readService = {
  getAuthoritativeForDate: vi.fn(),
  getLocalForDate: vi.fn(),
  getLocalForDateWithMeta: vi.fn(),
  getForDate: vi.fn(),
  getForDateWithMeta: vi.fn(),
  getPreviousDay: vi.fn(),
  getPreviousDayWithMeta: vi.fn(),
  getAvailableDates: vi.fn(),
  getMonthRecords: vi.fn(),
};

const initializationService = {
  initializeDay: vi.fn(),
  copyPatientToDateDetailed: vi.fn(),
};

const writeService = {
  updatePartialDetailed: vi.fn(),
  saveDetailed: vi.fn(),
};

const deletionService = {
  deleteDailyRecordAcrossStores: vi.fn(),
};

const syncService = {
  syncWithFirestoreDetailed: vi.fn(),
  subscribeDetailed: vi.fn<DailyRecordRepositoryPort['subscribeDetailed']>(),
};

vi.mock('@/services/repositories/dailyRecordRepositoryReadService', () => readService);
vi.mock(
  '@/services/repositories/dailyRecordRepositoryInitializationService',
  () => initializationService
);
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => writeService);
vi.mock('@/services/repositories/dailyRecordDeletionService', () => deletionService);
vi.mock('@/services/repositories/dailyRecordRepositorySyncService', () => syncService);

describe('dailyRecordPort lazy facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates read, write and firestore-backed queries through lazy services', async () => {
    readService.getForDate.mockResolvedValue({ id: 'record' });
    readService.getMonthRecords.mockResolvedValue([{ id: 'month-record' }]);
    writeService.updatePartialDetailed.mockResolvedValue({ outcome: 'saved' });
    writeService.saveDetailed.mockResolvedValue({ outcome: 'saved' });
    deletionService.deleteDailyRecordAcrossStores.mockResolvedValue(undefined);

    await defaultDailyRecordReadPort.getForDate('2026-04-10');
    await defaultDailyRecordReadPort.getAuthoritativeForDate('2026-04-10');
    await defaultDailyRecordReadPort.getLocalForDate('2026-04-10');
    await defaultDailyRecordReadPort.getLocalForDateWithMeta('2026-04-10');
    await defaultDailyRecordReadPort.getMonthRecords(2026, 3);
    await defaultDailyRecordWritePort.updatePartial('2026-04-10', {
      patientName: 'Ana',
    });
    await defaultDailyRecordWritePort.save({ date: '2026-04-10' } as never);
    await defaultDailyRecordRepositoryPort.saveDetailed(
      { date: '2026-04-11' } as never,
      'revision-1',
      { requireConfirmedRecord: true, rayenStructuralWriteGuard: true }
    );
    await defaultDailyRecordRepositoryPort.updatePartialDetailed('2026-04-11', {
      patientName: 'Beto',
    });
    await defaultDailyRecordRepositoryPort.deleteDay('2026-04-10');

    expect(readService.getForDate).toHaveBeenCalledWith('2026-04-10');
    expect(readService.getAuthoritativeForDate).toHaveBeenCalledWith('2026-04-10');
    expect(readService.getLocalForDate).toHaveBeenCalledWith('2026-04-10');
    expect(readService.getLocalForDateWithMeta).toHaveBeenCalledWith('2026-04-10');
    expect(readService.getMonthRecords).toHaveBeenCalledWith(2026, 3);
    expect(writeService.updatePartialDetailed).toHaveBeenCalledWith('2026-04-10', {
      patientName: 'Ana',
    });
    expect(writeService.saveDetailed).toHaveBeenCalledWith({ date: '2026-04-10' }, undefined);
    expect(writeService.saveDetailed).toHaveBeenCalledWith({ date: '2026-04-11' }, 'revision-1', {
      requireConfirmedRecord: true,
      rayenStructuralWriteGuard: true,
    });
    expect(writeService.updatePartialDetailed).toHaveBeenCalledWith('2026-04-11', {
      patientName: 'Beto',
    });
    expect(deletionService.deleteDailyRecordAcrossStores).toHaveBeenCalledWith('2026-04-10');
  });

  it('does not attach a subscription cancelled before the lazy module resolves', async () => {
    const unsubscribe = vi.fn();
    syncService.subscribeDetailed.mockReturnValue(unsubscribe);

    const stop = defaultDailyRecordRepositoryPort.subscribeDetailed('2026-04-10', vi.fn());
    stop();
    await vi.dynamicImportSettled();

    expect(syncService.subscribeDetailed).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('attaches and tears down the lazy sync subscription once the module resolves', async () => {
    const unsubscribe = vi.fn();
    const onRecord = vi.fn();
    syncService.subscribeDetailed.mockImplementationOnce((date, callback) => {
      callback(createSyncDailyRecordResult({ date, record: null, outcome: 'missing' }), false);
      return unsubscribe;
    });

    const stop = defaultDailyRecordRepositoryPort.subscribeDetailed('2026-04-10', onRecord);
    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ date: '2026-04-10', record: null, outcome: 'missing' }),
        false
      );
    });

    stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('forwards a subscription failure through the lazy repository port', async () => {
    const failure = createSyncDailyRecordResult({
      date: '2026-04-10',
      record: null,
      outcome: 'blocked',
    });
    const unsubscribe = vi.fn();
    const onFailure = vi.fn();
    const onRecord = vi.fn();
    syncService.subscribeDetailed.mockImplementationOnce((_date, _callback, failed) => {
      failed?.(failure);
      return unsubscribe;
    });
    const stop = defaultDailyRecordRepositoryPort.subscribeDetailed(
      '2026-04-10',
      onRecord,
      onFailure
    );
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure));
    expect(onRecord).not.toHaveBeenCalled();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
