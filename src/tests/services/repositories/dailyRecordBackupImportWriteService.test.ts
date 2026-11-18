import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { saveBackupImport } from '@/services/repositories/dailyRecordBackupImportWriteService';
import {
  createSaveDailyRecordResult,
  type SaveDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({ saveDetailed: vi.fn() }));

vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mocks.saveDetailed,
}));

/**
 * Restoring a backup writes each day on this computer before anything is sent (W14-D1-5b): a
 * write that left no local copy stops the import instead of counting the day as restored.
 */
const DATE = '2026-11-17';
const day = DataFactory.createMockDailyRecord(DATE, { lastUpdated: '2026-11-17T08:00:00.000Z' });

const savedHere = (savedLocally: boolean): SaveDailyRecordResult =>
  createSaveDailyRecordResult({
    date: DATE,
    outcome: 'clean',
    savedLocally,
    savedRemotely: false,
    queuedForRetry: false,
    autoMerged: false,
  });

describe('saveBackupImport', () => {
  beforeEach(async () => {
    mocks.saveDetailed.mockReset();
    await hospitalDB.open();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it('restores a day this computer stored', async () => {
    mocks.saveDetailed.mockResolvedValue(savedHere(true));

    await expect(saveBackupImport([day], [DATE])).resolves.toEqual([]);
    expect(mocks.saveDetailed).toHaveBeenCalledTimes(1);
  });

  it('stops when the write left no local copy', async () => {
    mocks.saveDetailed.mockResolvedValue(savedHere(false));

    await expect(saveBackupImport([day], [DATE])).rejects.toThrow(
      'No fue posible guardar el respaldo local.'
    );
  });
});
