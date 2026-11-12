import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hydrateRangeRecords } from '@/services/admin/dataMaintenanceSupport';
import {
  exportMonthRecordsWithOutcome,
  exportYearToDateRecordsWithOutcome,
} from '@/services/admin/dataMaintenanceService';

const mocks = vi.hoisted(() => ({ remote: vi.fn(), enabled: vi.fn(), download: vi.fn() }));
vi.mock('@/services/storage/firestore', () => ({
  getRecordsRangeFromFirestore: mocks.remote,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: mocks.enabled,
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: vi.fn(),
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'synthetic@example.test',
}));
vi.mock('@/services/exporters/clinicalDerivedBackupSection', () => ({
  buildClinicalDerivedBackupSection: vi.fn(),
  describeIncompleteClinicalDerivedBackup: vi.fn(),
}));
vi.mock('file-saver', () => ({ saveAs: mocks.download }));

const date = '2026-04-02';
const record = (note: string, lastUpdated = '2026-04-02T12:00:00.000Z') =>
  DataFactory.createMockDailyRecord(date, { medicalHandoffNovedades: note, lastUpdated });

describe('maintenance range with real local storage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it.each(['month', 'year'])(
    'rejects %s backup when the local range cannot be read',
    async scope => {
      mocks.remote.mockResolvedValue([record('Remote only')]);
      vi.spyOn(hospitalDB.Collection.prototype, 'toArray').mockRejectedValueOnce(
        new Error('synthetic range failure')
      );
      const result = await (scope === 'month'
        ? exportMonthRecordsWithOutcome(2026, 4)
        : exportYearToDateRecordsWithOutcome(2026));
      expect(result).toMatchObject({ status: 'failed', data: null });
      expect(result.userSafeMessage).toContain('synthetic range failure');
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.remote).not.toHaveBeenCalled();
    }
  );

  it('retains an edit queued while the remote maintenance read is in flight', async () => {
    await hospitalDB.dailyRecords.put(record('Original'));
    const local = record('Pending during read');
    mocks.remote.mockImplementation(async () => {
      await hospitalDB.dailyRecords.put(local);
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-race',
        key: `daily:${date}`,
        type: 'UPDATE_DAILY_RECORD',
        status: 'PENDING',
        payload: local,
        timestamp: 1,
        retryCount: 0,
      });
      return [record('Remote', '2026-04-02T14:00:00.000Z')];
    });
    expect(await hydrateRangeRecords(date, date)).toEqual([local]);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(local);
    expect(await hospitalDB.syncQueue.count()).toBe(1);
  });

  it('keeps and returns the pending local note even when the remote timestamp wins the merge', async () => {
    const local = record('Nota local nueva');
    await hospitalDB.dailyRecords.put(local);
    const id = await hospitalDB.syncQueue.add({
      opId: 'synthetic-maintenance',
      key: `daily:${date}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: local,
      timestamp: 1,
      retryCount: 0,
    });
    const task = await hospitalDB.syncQueue.get(id);
    mocks.remote.mockResolvedValue([record('Nota remota', '2026-04-02T13:00:00.000Z')]);

    const result = await hydrateRangeRecords(date, date);

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(local);
    expect(result).toEqual([local]);
    expect(await hospitalDB.syncQueue.get(id)).toEqual(task);
  });

  it.each(['month', 'year'])(
    'fails the %s export without downloading if local storage rejects',
    async scope => {
      const local = record('Local');
      await hospitalDB.dailyRecords.put(local);
      mocks.remote.mockResolvedValue([record('Remota', '2026-04-02T13:00:00.000Z')]);
      vi.spyOn(hospitalDB.dailyRecords, 'bulkPut').mockRejectedValue(
        new Error('synthetic storage failure')
      );

      const result = await (scope === 'month'
        ? exportMonthRecordsWithOutcome(2026, 4)
        : exportYearToDateRecordsWithOutcome(2026));

      expect(result).toMatchObject({ status: 'failed', data: null });
      expect(result.userSafeMessage).toBeTruthy();
      expect(mocks.download).not.toHaveBeenCalled();
      expect(await hospitalDB.dailyRecords.toArray()).toEqual([local]);
    }
  );

  it('preserves merge preference and ascending order without pending edits', async () => {
    const local = record('Local');
    const remote = record('Remota', '2026-04-02T13:00:00.000Z');
    const earlier = { ...record('Solo local'), date: '2026-04-01' };
    const later = { ...record('Solo remota'), date: '2026-04-03' };
    await hospitalDB.dailyRecords.bulkPut([local, earlier]);
    mocks.remote.mockResolvedValue([later, remote]);
    expect(await hydrateRangeRecords('2026-04-01', '2026-04-03')).toEqual([earlier, remote, later]);
    expect(await hospitalDB.dailyRecords.toArray()).toEqual([earlier, remote, later]);
  });

  it('returns only local records without remote reads or writes when Firestore is disabled', async () => {
    const local = record('Local');
    await hospitalDB.dailyRecords.put(local);
    mocks.enabled.mockReturnValue(false);
    const write = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    expect(await hydrateRangeRecords(date, date)).toEqual([local]);
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('returns an empty range without writing', async () => {
    mocks.remote.mockResolvedValue([]);
    const write = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    expect(await hydrateRangeRecords(date, date)).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });
});
