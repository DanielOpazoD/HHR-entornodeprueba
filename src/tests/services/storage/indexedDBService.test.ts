import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as idbService from '@/services/storage/indexedDBService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { ErrorLog } from '@/services/utils/errorService';

const FIXED_ISO_TIMESTAMP = '2026-01-15T10:30:00.000Z';

describe('indexedDBService', () => {
  const setMockLocationWithReload = () => {
    const originalLocation = window.location;
    // @ts-expect-error - test override
    delete window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
    return originalLocation;
  };

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
    await idbService.clearAllRecords();
    await idbService.clearErrorLogs();
    await idbService.clearAuditLogs();
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Daily Records', () => {
    it('should save and retrieve a record', async () => {
      await idbService.saveRecord(mockRecord);
      const retrieved = await idbService.getRecordForDate('2025-01-01');
      expect(retrieved).toMatchObject({ date: '2025-01-01' });
    });

    it('should return null for non-existent record', async () => {
      const retrieved = await idbService.getRecordForDate('9999-12-31');
      expect(retrieved).toBeNull();
    });

    it('should get all records', async () => {
      await idbService.saveRecord(mockRecord);
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-02' });

      const all = await idbService.getAllRecords();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['2025-01-01']).toBeDefined();
      expect(all['2025-01-02']).toBeDefined();
    });

    it('should get records for a specific month', async () => {
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-01' });
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-05' });
      await idbService.saveRecord({ ...mockRecord, date: '2025-02-01' });

      const janRecords = await idbService.getRecordsForMonth(2025, 1);
      expect(janRecords).toHaveLength(2);
      expect(janRecords.map(record => record.date)).toEqual(['2025-01-05', '2025-01-01']);
    });

    it('should get the previous day record', async () => {
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-01' });
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-05' });

      const prev = await idbService.getPreviousDayRecord('2025-01-10');
      expect(prev?.date).toBe('2025-01-05');
    });

    it('should delete a record', async () => {
      await idbService.saveRecord(mockRecord);
      await idbService.deleteRecord('2025-01-01');
      const retrieved = await idbService.getRecordForDate('2025-01-01');
      expect(retrieved).toBeNull();
    });

    it('should bulk save and return all records sorted descending', async () => {
      await idbService.saveRecords([
        { ...mockRecord, date: '2025-01-02' },
        { ...mockRecord, date: '2025-01-03' },
        { ...mockRecord, date: '2025-01-01' },
      ]);

      const sorted = await idbService.getAllRecordsSorted();
      expect(sorted.map(record => record.date)).toEqual(['2025-01-03', '2025-01-02', '2025-01-01']);
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
      await idbService.saveErrorLog(log);
      const logs = await idbService.getErrorLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Test error');
    });

    it('should clear error logs', async () => {
      await idbService.saveErrorLog({
        id: '2',
        timestamp: FIXED_ISO_TIMESTAMP,
        message: 'err',
        severity: 'high',
      } as ErrorLog);
      await idbService.clearErrorLogs();
      const logs = await idbService.getErrorLogs();
      expect(logs).toHaveLength(0);
    });
  });

  describe('Catalogs', () => {
    it('should save and retrieve catalogs', async () => {
      await idbService.saveCatalog('nurses', ['Alice', 'Bob']);
      const list = await idbService.getCatalog('nurses');
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

      const migrated = await idbService.migrateFromLocalStorage();
      expect(migrated).toBe(true);

      expect(await idbService.getRecordForDate('2025-01-01')).toBeDefined();
      expect(await idbService.getCatalog('nurses')).toEqual(['Alice']);
      expect(await idbService.getCatalog('tens')).toEqual(['Bob']);
      const logs = await idbService.getAuditLogs();
      expect(logs).toHaveLength(1);
    });

    it('should not migrate if flag is set', async () => {
      localStorage.setItem('indexeddb_migration_complete', 'true');
      const migrated = await idbService.migrateFromLocalStorage();
      expect(migrated).toBe(false);
    });

    it('should skip migration and mark complete when no legacy payload exists', async () => {
      const migrated = await idbService.migrateFromLocalStorage();
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
      await idbService.saveAuditLog(log);
      await idbService.saveAuditLog({ ...log, id: 'a2', recordDate: '2025-01-02' });

      const logs = await idbService.getAuditLogsForDate('2025-01-01');
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('a1');
    });

    it('should respect limit in getAuditLogs', async () => {
      for (let i = 0; i < 5; i++) {
        await idbService.saveAuditLog({
          id: `l${i}`,
          timestamp: FIXED_ISO_TIMESTAMP,
          action: 'SYSTEM_ERROR',
          userId: 'test@local',
          entityType: 'system',
          entityId: `log-${i}`,
          details: {},
        } as AuditLogEntry);
      }
      const logs = await idbService.getAuditLogs(3);
      expect(logs).toHaveLength(3);
    });

    it('should return all audit logs when no limit is provided', async () => {
      for (let i = 0; i < 5; i++) {
        await idbService.saveAuditLog({
          id: `full-${i}`,
          timestamp: FIXED_ISO_TIMESTAMP,
          action: 'SYSTEM_ERROR',
          userId: 'test@local',
          entityType: 'system',
          entityId: `full-log-${i}`,
          details: {},
        } as AuditLogEntry);
      }

      const logs = await idbService.getAuditLogs();

      expect(logs).toHaveLength(5);
    });
  });

  describe('Settings', () => {
    it('should save and get settings', async () => {
      await idbService.saveSetting('theme', 'dark');
      const val = await idbService.getSetting('theme', 'light');
      expect(val).toBe('dark');
    });

    it('should return default value if setting not found', async () => {
      const val = await idbService.getSetting('non-existent', 'default');
      expect(val).toBe('default');
    });
  });

  describe('Utilities and Edge Cases', () => {
    it('should return all dates sorted correctly', async () => {
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-01' });
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-03' });
      await idbService.saveRecord({ ...mockRecord, date: '2025-01-02' });

      const dates = await idbService.getAllDates();
      expect(dates).toEqual(['2025-01-03', '2025-01-02', '2025-01-01']);
    });

    it('should check if indexedDB is available', () => {
      expect(idbService.isIndexedDBAvailable()).toBe(true);
    });

    it('should report fallback mode correctly', () => {
      // In tests we are using real fake-indexeddb usually, so it should be false
      expect(idbService.isDatabaseInFallbackMode()).toBe(false);
    });

    it('should handle getErrorLogs with limit', async () => {
      await idbService.saveErrorLog({
        id: 'e1',
        timestamp: '2025-01-01',
        message: 'e1',
        severity: 'medium',
      } as ErrorLog);
      await idbService.saveErrorLog({
        id: 'e2',
        timestamp: '2025-01-02',
        message: 'e2',
        severity: 'medium',
      } as ErrorLog);
      const logs = await idbService.getErrorLogs(1);
      expect(logs).toHaveLength(1);
    });
  });

  describe('Local App Reset', () => {
    it('should clear all and reload (mocked reload)', async () => {
      // Mock location.reload
      const originalLocation = setMockLocationWithReload();

      // Mock indexedDB.databases since it might not be in JSDOM / fake-indexeddb
      const originalDatabases = window.indexedDB.databases;
      window.indexedDB.databases = vi.fn().mockResolvedValue([{ name: 'HangaRoaDB' }]);
      const originalDelete = window.indexedDB.deleteDatabase;
      window.indexedDB.deleteDatabase = vi.fn();

      await idbService.resetLocalDatabase();

      expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
      expect(window.location.reload).toHaveBeenCalled();

      // Restore
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
      window.indexedDB.databases = originalDatabases;
      window.indexedDB.deleteDatabase = originalDelete;
    });

    it('should unregister service workers in performClientHardReset', async () => {
      const originalLocation = setMockLocationWithReload();

      const originalDatabases = window.indexedDB.databases;
      window.indexedDB.databases = vi.fn().mockResolvedValue([{ name: 'HangaRoaDB' }]);
      const originalDelete = window.indexedDB.deleteDatabase;
      window.indexedDB.deleteDatabase = vi.fn();

      const unregister = vi.fn().mockResolvedValue(undefined);
      const registrations = [{ unregister }] as unknown as ServiceWorkerRegistration[];
      const getRegistrations = vi.fn().mockResolvedValue(registrations);
      const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistrations },
      });
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');
      localStorage.setItem('hhr_bootstrap_storage_repair_v1', '1');

      await idbService.performClientHardReset();

      expect(getRegistrations).toHaveBeenCalled();
      expect(unregister).toHaveBeenCalled();
      expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
      expect(localStorage.getItem('firebase:authUser:test:[DEFAULT]')).toBe('{"uid":"abc"}');
      expect(localStorage.getItem('hhr_bootstrap_storage_repair_v1')).toBeNull();
      expect(window.location.reload).toHaveBeenCalled();

      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
      window.indexedDB.databases = originalDatabases;
      window.indexedDB.deleteDatabase = originalDelete;
      if (originalServiceWorker) {
        Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
      } else {
        // @ts-expect-error - cleanup test-only property
        delete navigator.serviceWorker;
      }
    });

    it('should expose resetLocalAppStorage as the same full reset behavior', async () => {
      const originalLocation = setMockLocationWithReload();

      const originalDatabases = window.indexedDB.databases;
      window.indexedDB.databases = vi.fn().mockResolvedValue([{ name: 'HangaRoaDB' }]);
      const originalDelete = window.indexedDB.deleteDatabase;
      window.indexedDB.deleteDatabase = vi.fn();

      const unregister = vi.fn().mockResolvedValue(undefined);
      const registrations = [{ unregister }] as unknown as ServiceWorkerRegistration[];
      const getRegistrations = vi.fn().mockResolvedValue(registrations);
      const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistrations },
      });
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');

      await idbService.resetLocalAppStorage();

      expect(getRegistrations).toHaveBeenCalled();
      expect(unregister).toHaveBeenCalled();
      expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
      expect(localStorage.getItem('firebase:authUser:test:[DEFAULT]')).toBeNull();
      expect(window.location.reload).toHaveBeenCalled();

      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
      window.indexedDB.databases = originalDatabases;
      window.indexedDB.deleteDatabase = originalDelete;
      if (originalServiceWorker) {
        Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
      } else {
        // @ts-expect-error - cleanup test-only property
        delete navigator.serviceWorker;
      }
    });
  });

  describe('Additional Clear Operations', () => {
    it('should clear catalog', async () => {
      await idbService.saveCatalog('nurses', ['Alice']);
      await idbService.clearCatalog('nurses');
      const list = await idbService.getCatalog('nurses');
      expect(list).toEqual([]);
    });

    it('should clear all settings', async () => {
      await idbService.saveSetting('s1', 'v1');
      await idbService.clearAllSettings();
      const val = await idbService.getSetting('s1', 'default');
      expect(val).toBe('default');
    });
  });
});
