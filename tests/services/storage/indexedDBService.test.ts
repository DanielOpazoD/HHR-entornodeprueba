import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as idbService from '@/services/storage/indexedDBService';
import { DailyRecord, Specialty, PatientStatus } from '@/types';
import Dexie from 'dexie';

describe('indexedDBService', () => {
    const mockRecord: DailyRecord = {
        date: '2025-01-01',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
        nurses: [],
        activeExtraBeds: []
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
    });

    describe('Error Logs', () => {
        it('should save and retrieve error logs', async () => {
            const log = { id: '1', timestamp: Date.now(), message: 'Test error', severity: 'error' as const };
            await idbService.saveErrorLog(log);
            const logs = await idbService.getErrorLogs();
            expect(logs).toHaveLength(1);
            expect(logs[0].message).toBe('Test error');
        });

        it('should clear error logs', async () => {
            await idbService.saveErrorLog({ id: '1', timestamp: Date.now(), message: 'err', severity: 'error' });
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
        it('should migrate data from localStorage', async () => {
            const records = { '2025-01-01': mockRecord };
            localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(records));
            localStorage.setItem('hanga_roa_nurses_list', JSON.stringify(['Alice']));

            const migrated = await idbService.migrateFromLocalStorage();
            expect(migrated).toBe(true);

            const record = await idbService.getRecordForDate('2025-01-01');
            expect(record).toBeDefined();
            const nurses = await idbService.getCatalog('nurses');
            expect(nurses).toEqual(['Alice']);
        });

        it('should not migrate if flag is set', async () => {
            localStorage.setItem('indexeddb_migration_complete', 'true');
            const migrated = await idbService.migrateFromLocalStorage();
            expect(migrated).toBe(false);
        });
    });

    describe('Hard Reset', () => {
        it('should clear all and reload (mocked reload)', async () => {
            // Mock location.reload
            const originalLocation = window.location;
            delete (window as any).location;
            window.location = { ...originalLocation, reload: vi.fn() };

            await idbService.resetLocalDatabase();

            expect(window.location.reload).toHaveBeenCalled();

            // Restore location
            window.location = originalLocation;
        });
    });
});
