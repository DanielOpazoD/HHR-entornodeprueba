import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  admitLocalRecords,
  clearAllRecords,
  deleteRecord,
  getAllDates,
  getAllRecords,
  getPreviousDayRecord,
  getRecordForDateStrict,
  getRecordsForMonth,
  saveRecord,
  saveRecordStrict,
  saveRecordsStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  clearErrorLogs,
  getErrorLogs,
  saveErrorLog,
} from '@/services/storage/indexeddb/indexedDbErrorLogService';
import {
  clearAuditLogs,
  getAuditLogs,
  getAuditLogsForDate,
  saveAuditLog,
} from '@/services/storage/indexeddb/indexedDbAuditLogService';
import {
  clearCatalog,
  getCatalog,
  saveCatalog,
} from '@/services/storage/indexeddb/indexedDbCatalogService';
import { migrateFromLocalStorage } from '@/services/storage/indexeddb/indexedDbMigrationService';
import {
  clearAllSettings,
  getSetting,
  saveSetting,
} from '@/services/storage/indexeddb/indexedDbSettingsService';
import * as indexedDbCore from '@/services/storage/indexeddb/indexedDbCore';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { ErrorLog } from '@/services/utils/errorService';

const FIXED_ISO_TIMESTAMP = '2026-01-15T10:30:00.000Z';

describe('indexedDBService', () => {
  const mockRecord: DailyRecord = {
    date: '2025-01-01',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: FIXED_ISO_TIMESTAMP,
    nurses: [],
    activeExtraBeds: [],
  };

  beforeEach(async () => {
    // Clear all stores before each test
    await clearAllRecords();
    await indexedDbCore.hospitalDB.syncQueue.clear();
    await clearErrorLogs();
    await clearAuditLogs();
    localStorage.clear();
    sessionStorage.clear();
    window.__HHR_E2E_OVERRIDE__ = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses durable admission and queue evidence even with a synthetic census override', async () => {
    window.__HHR_E2E_OVERRIDE__ = { [mockRecord.date]: mockRecord };
    try {
      const [admitted] = await admitLocalRecords([{ record: mockRecord, serverConfirmed: true }]);
      expect(admitted.record).toEqual(mockRecord);
      expect(await indexedDbCore.hospitalDB.dailyRecords.get(mockRecord.date)).toEqual(mockRecord);
      const pending = {
        opId: 'synthetic-runtime-pending',
        type: 'UPDATE_DAILY_RECORD' as const,
        key: `daily:${mockRecord.date}`,
        payload: mockRecord,
        status: 'PENDING' as const,
        timestamp: 1,
        retryCount: 0,
      };
      const id = await indexedDbCore.hospitalDB.syncQueue.add(pending);
      const [retained] = await admitLocalRecords([
        {
          record: { ...mockRecord, nursesDayShift: ['REMOTE'] },
          serverConfirmed: true,
        },
      ]);
      expect(retained.status).toBe('retained_pending');
      expect(retained.record).toEqual(mockRecord);
      expect(await indexedDbCore.hospitalDB.syncQueue.toArray()).toEqual([{ ...pending, id }]);
    } finally {
      window.__HHR_E2E_OVERRIDE__ = undefined;
    }
  });

  describe('Daily Records', () => {
    it.each(['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'] as const)(
      'preserves the local projection and %s task during hydration',
      async status => {
        await saveRecordStrict(mockRecord);
        await indexedDbCore.hospitalDB.syncQueue.add({
          opId: 'hydration-test',
          type: 'UPDATE_DAILY_RECORD',
          key: `daily:${mockRecord.date}`,
          payload: mockRecord,
          status,
          timestamp: 1767225600000,
          retryCount: 0,
        });
        const remote = { ...mockRecord, lastUpdated: '2026-01-15T10:31:00.000Z' };
        expect(await saveRecordStrict(remote, { preserveUnresolvedWrites: true })).toMatchObject({
          ok: true,
          retainedRecord: mockRecord,
        });
        expect(await indexedDbCore.hospitalDB.dailyRecords.get(mockRecord.date)).toEqual(
          mockRecord
        );
        expect((await indexedDbCore.hospitalDB.syncQueue.toArray())[0].status).toBe(status);
      }
    );

    it('hydrates the fallback cache without querying unavailable IndexedDB', async () => {
      vi.spyOn(indexedDbCore, 'isDatabaseInFallbackMode').mockReturnValue(true);
      const queueRead = vi
        .spyOn(indexedDbCore.hospitalDB.syncQueue, 'where')
        .mockImplementation(() => {
          throw new Error('IndexedDB unavailable');
        });
      const result = await saveRecordStrict(mockRecord, {
        preserveUnresolvedWrites: true,
      });
      expect(result).toMatchObject({ ok: true, store: 'fallback' });
      expect(queueRead).not.toHaveBeenCalled();
      expect(await getRecordForDateStrict(mockRecord.date)).toMatchObject(mockRecord);
    });

    it('should report the backing store used by strict record saves', async () => {
      const result = await saveRecordStrict(mockRecord);

      expect(result).toMatchObject({
        ok: true,
        operation: 'save',
        store: 'indexeddb',
        dates: ['2025-01-01'],
      });
      await expect(getRecordForDateStrict('2025-01-01')).resolves.toMatchObject({
        date: '2025-01-01',
      });
    });

    it('does not mirror regular localhost writes into legacy localStorage', async () => {
      const result = await saveRecordStrict(mockRecord);

      expect(result.ok).toBe(true);
      expect(localStorage.getItem('hanga_roa_hospital_data')).toBeNull();
      await expect(getRecordForDateStrict('2025-01-01')).resolves.toMatchObject({
        date: '2025-01-01',
      });
    });

    it('should report strict record save failures without dispatching a success result', async () => {
      const putSpy = vi
        .spyOn(indexedDbCore.hospitalDB.dailyRecords, 'put')
        .mockRejectedValueOnce(new Error('quota exceeded'));

      const result = await saveRecordStrict(mockRecord);

      expect(result).toMatchObject({
        ok: false,
        operation: 'save',
        store: 'none',
        dates: ['2025-01-01'],
      });
      expect(result.error).toBeInstanceOf(Error);
      putSpy.mockRestore();
    });

    it('should save and retrieve a record', async () => {
      await saveRecord(mockRecord);
      const retrieved = await getRecordForDateStrict('2025-01-01');
      expect(retrieved).toMatchObject({ date: '2025-01-01' });
    });

    it('should return null for non-existent record', async () => {
      const retrieved = await getRecordForDateStrict('9999-12-31');
      expect(retrieved).toBeNull();
    });

    it('should get all records', async () => {
      await saveRecord(mockRecord);
      await saveRecord({ ...mockRecord, date: '2025-01-02' });

      const all = await getAllRecords();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['2025-01-01']).toBeDefined();
      expect(all['2025-01-02']).toBeDefined();
    });

    it('should get records for a specific month', async () => {
      await saveRecord({ ...mockRecord, date: '2025-01-01' });
      await saveRecord({ ...mockRecord, date: '2025-01-05' });
      await saveRecord({ ...mockRecord, date: '2025-02-01' });

      const janRecords = await getRecordsForMonth(2025, 1);
      expect(janRecords).toHaveLength(2);
      expect(janRecords.map(record => record.date)).toEqual(['2025-01-05', '2025-01-01']);
    });

    it('should get the previous day record', async () => {
      await saveRecord({ ...mockRecord, date: '2025-01-01' });
      await saveRecord({ ...mockRecord, date: '2025-01-05' });

      const prev = await getPreviousDayRecord('2025-01-10');
      expect(prev?.date).toBe('2025-01-05');
    });

    it('should delete a record', async () => {
      await saveRecord(mockRecord);
      await deleteRecord('2025-01-01');
      const retrieved = await getRecordForDateStrict('2025-01-01');
      expect(retrieved).toBeNull();
    });

    it('should bulk save all records', async () => {
      await saveRecordsStrict([
        { ...mockRecord, date: '2025-01-02' },
        { ...mockRecord, date: '2025-01-03' },
        { ...mockRecord, date: '2025-01-01' },
      ]);

      const stored = await getAllRecords();
      expect(Object.keys(stored).sort()).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    });
  });

  describe('Error Logs', () => {
    it('should save and retrieve error logs', async () => {
      const log = {
        id: '1',
        timestamp: FIXED_ISO_TIMESTAMP,
        message: 'Test error',
        severity: 'high',
      } as ErrorLog;
      await saveErrorLog(log);
      const logs = await getErrorLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Test error');
    });

    it('should clear error logs', async () => {
      await saveErrorLog({
        id: '2',
        timestamp: FIXED_ISO_TIMESTAMP,
        message: 'err',
        severity: 'high',
      } as ErrorLog);
      await clearErrorLogs();
      const logs = await getErrorLogs();
      expect(logs).toHaveLength(0);
    });
  });

  describe('Catalogs', () => {
    it('should save and retrieve catalogs', async () => {
      await saveCatalog('nurses', ['Alice', 'Bob']);
      const list = await getCatalog('nurses');
      expect(list).toEqual(['Alice', 'Bob']);
    });
  });

  describe('Migration', () => {
    it('should migrate data from localStorage (all types)', async () => {
      const records = { '2025-01-01': mockRecord };
      const nurses = ['Alice'];
      const tens = ['Bob'];
      const auditLogs = [{ id: 'a1', timestamp: FIXED_ISO_TIMESTAMP }];

      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(records));
      localStorage.setItem('hanga_roa_nurses_list', JSON.stringify(nurses));
      localStorage.setItem('hanga_roa_tens_list', JSON.stringify(tens));
      localStorage.setItem('hanga_roa_audit_logs', JSON.stringify(auditLogs));

      const announced: unknown[] = [];
      const steps: string[] = [];
      const bulkPut = indexedDbCore.hospitalDB.dailyRecords.bulkPut.bind(
        indexedDbCore.hospitalDB.dailyRecords
      );
      const bulkPutSpy = vi
        .spyOn(indexedDbCore.hospitalDB.dailyRecords, 'bulkPut')
        .mockImplementation((...args: Parameters<typeof bulkPut>) =>
          bulkPut(...args).then(written => {
            steps.push('written');
            return written;
          })
        );
      const listener = (event: Event) => {
        steps.push('announced');
        announced.push((event as CustomEvent).detail);
      };
      window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, listener);
      const migrated = await migrateFromLocalStorage();
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, listener);
      bulkPutSpy.mockRestore();
      expect(migrated).toBe(true);
      // Calendar markers and other local views refresh from this event, like any other save,
      // so it must come after the records are written.
      expect(announced).toEqual([{ operation: 'save', dates: ['2025-01-01'] }]);
      expect(steps).toEqual(['written', 'announced']);

      expect(await getRecordForDateStrict('2025-01-01')).toBeDefined();
      expect(await getCatalog('nurses')).toEqual(['Alice']);
      expect(await getCatalog('tens')).toEqual(['Bob']);
      const logs = await getAuditLogs();
      expect(logs).toHaveLength(1);
    });

    it('should not migrate if flag is set', async () => {
      localStorage.setItem('indexeddb_migration_complete', 'true');
      const migrated = await migrateFromLocalStorage();
      expect(migrated).toBe(false);
    });

    it('should skip migration and mark complete when no legacy payload exists', async () => {
      const migrated = await migrateFromLocalStorage();
      expect(migrated).toBe(false);
      expect(localStorage.getItem('indexeddb_migration_complete')).toBe('true');
    });
  });

  describe('Audit Logs Extended', () => {
    it('should get audit logs for a specific date', async () => {
      const log = {
        id: 'a1',
        timestamp: FIXED_ISO_TIMESTAMP,
        action: 'USER_LOGIN',
        userId: 'test@local',
        entityType: 'system',
        entityId: 'auth',
        details: {},
        recordDate: '2025-01-01',
      } as AuditLogEntry;
      await saveAuditLog(log);
      await saveAuditLog({ ...log, id: 'a2', recordDate: '2025-01-02' });

      const logs = await getAuditLogsForDate('2025-01-01');
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('a1');
    });

    it('should respect limit in getAuditLogs', async () => {
      for (let i = 0; i < 5; i++) {
        await saveAuditLog({
          id: `l${i}`,
          timestamp: FIXED_ISO_TIMESTAMP,
          action: 'SYSTEM_ERROR',
          userId: 'test@local',
          entityType: 'system',
          entityId: `log-${i}`,
          details: {},
        } as AuditLogEntry);
      }
      const logs = await getAuditLogs(3);
      expect(logs).toHaveLength(3);
    });

    it('should return all audit logs when no limit is provided', async () => {
      for (let i = 0; i < 5; i++) {
        await saveAuditLog({
          id: `full-${i}`,
          timestamp: FIXED_ISO_TIMESTAMP,
          action: 'SYSTEM_ERROR',
          userId: 'test@local',
          entityType: 'system',
          entityId: `full-log-${i}`,
          details: {},
        } as AuditLogEntry);
      }

      const logs = await getAuditLogs();

      expect(logs).toHaveLength(5);
    });
  });

  describe('Settings', () => {
    it('should save and get settings', async () => {
      await saveSetting('theme', 'dark');
      const val = await getSetting('theme', 'light');
      expect(val).toBe('dark');
    });

    it('should return default value if setting not found', async () => {
      const val = await getSetting('non-existent', 'default');
      expect(val).toBe('default');
    });
  });

  describe('Utilities and Edge Cases', () => {
    it('should return all dates sorted correctly', async () => {
      await saveRecord({ ...mockRecord, date: '2025-01-01' });
      await saveRecord({ ...mockRecord, date: '2025-01-03' });
      await saveRecord({ ...mockRecord, date: '2025-01-02' });

      const dates = await getAllDates();
      expect(dates).toEqual(['2025-01-03', '2025-01-02', '2025-01-01']);
    });

    it('should check if indexedDB is available', () => {
      expect(indexedDbCore.isIndexedDBAvailable()).toBe(true);
    });

    it('should report fallback mode correctly', () => {
      // In tests we are using real fake-indexeddb usually, so it should be false
      expect(indexedDbCore.isDatabaseInFallbackMode()).toBe(false);
    });

    it('should handle getErrorLogs with limit', async () => {
      await saveErrorLog({
        id: 'e1',
        timestamp: '2025-01-01',
        message: 'e1',
        severity: 'medium',
      } as ErrorLog);
      await saveErrorLog({
        id: 'e2',
        timestamp: '2025-01-02',
        message: 'e2',
        severity: 'medium',
      } as ErrorLog);
      const logs = await getErrorLogs(1);
      expect(logs).toHaveLength(1);
    });
  });

  describe('Additional Clear Operations', () => {
    it('should clear catalog', async () => {
      await saveCatalog('nurses', ['Alice']);
      await clearCatalog('nurses');
      const list = await getCatalog('nurses');
      expect(list).toEqual([]);
    });

    it('should clear all settings', async () => {
      await saveSetting('s1', 'v1');
      await clearAllSettings();
      const val = await getSetting('s1', 'default');
      expect(val).toBe('default');
    });
  });
});
