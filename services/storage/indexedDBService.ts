/**
 * IndexedDB Service using Dexie.js
 * 
 * Provides persistent storage with unlimited capacity (vs 5MB localStorage limit).
 * Includes automatic migration from localStorage to IndexedDB.
 */

import Dexie, { Table } from 'dexie';
import { DailyRecord } from '../../types';
import { ErrorLog } from '../utils/errorService';
import { AuditLogEntry } from '../../types/audit';

// ============================================================================
// Database Schema
// ============================================================================

class HangaRoaDatabase extends Dexie {
    dailyRecords!: Table<DailyRecord>;
    demoRecords!: Table<DailyRecord>;
    catalogs!: Table<{ id: string, list: string[], lastUpdated: string }>;
    errorLogs!: Table<ErrorLog>;
    auditLogs!: Table<AuditLogEntry>;
    settings!: Table<{ id: string, value: unknown }>;

    constructor() {
        super('HangaRoaDB');

        this.version(5).stores({
            dailyRecords: 'date',
            demoRecords: 'date',
            catalogs: 'id',
            errorLogs: 'id, timestamp, severity',
            auditLogs: 'id, timestamp, action, entityId, recordDate',
            settings: 'id'
        });
    }
}

/**
 * Mock fallback for HangaRoaDatabase when initialization fails.
 */
export const createMockDatabase = (): HangaRoaDatabase => {
    const mockTable = {
        toArray: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(''),
        delete: () => Promise.resolve(),
        clear: () => Promise.resolve(),
        bulkPut: () => Promise.resolve(''),
        add: () => Promise.resolve(''),
        orderBy: () => ({
            reverse: () => ({
                limit: () => ({ toArray: () => Promise.resolve([]) }),
                keys: () => Promise.resolve([]),
                toArray: () => Promise.resolve([])
            })
        }),
        where: (key: string) => ({
            below: () => ({
                reverse: () => ({
                    first: () => Promise.resolve(null)
                })
            }),
            equals: () => ({
                first: () => Promise.resolve(null),
                toArray: () => Promise.resolve([])
            }),
            startsWith: () => ({
                toArray: () => Promise.resolve([])
            })
        })
    } as any;

    return {
        dailyRecords: mockTable,
        demoRecords: mockTable,
        catalogs: mockTable,
        auditLogs: mockTable,
        settings: mockTable,
        isOpen: () => true,
        open: () => Promise.resolve(),
        on: () => ({})
    } as unknown as HangaRoaDatabase;
};

// Singleton instance with safety
let db: HangaRoaDatabase;
let isUsingMock = false;

try {
    db = new HangaRoaDatabase();

    // Handle blocking (multiple tabs trying to upgrade)
    db.on('blocked', () => {
        console.warn('[IndexedDB] ⏳ Database is blocked by another tab');
    });

} catch (e) {
    console.error('[IndexedDB] ❌ Failed to construct HangaRoaDatabase:', e);
    db = createMockDatabase();
    isUsingMock = true;
}

let isOpening = false;

/**
 * Ensures the database is open or falls back to mock.
 * Includes automatic recovery logic for Chrome's "UnknownError".
 */
const ensureDbReady = async () => {
    if (isUsingMock) return;
    if (db.isOpen()) return;

    if (isOpening) {
        while (isOpening) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (db.isOpen() || isUsingMock) return;
        }
        return;
    }

    isOpening = true;
    try {
        await db.open();
    } catch (err: unknown) {
        const errorName = err && typeof err === 'object' && 'name' in err ? String(err.name) : 'Unknown';
        const errorMessage = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);

        console.warn('[IndexedDB] ⚠️ Initial open failed, attempting auto-recovery:', errorName || errorMessage);

        // If it's a known persistent error (like UnknownError or VersionError), 
        // try to delete and recreate the database once.
        if (errorName === 'UnknownError' || errorName === 'VersionError') {
            try {
                console.warn('[IndexedDB] 🛠️ Deleting corrupted database for recreation...');
                await db.close();
                await Dexie.delete('HangaRoaDB');

                // Re-instantiate and try again
                db = new HangaRoaDatabase();
                await db.open();

                console.info('[IndexedDB] ✨ Database successfully recreated and opened');

                // Re-trigger migration since we started fresh
                localStorage.removeItem(MIGRATION_FLAG);
                migrateFromLocalStorage();

                isOpening = false;
                return;
            } catch (recoveryErr) {
                console.error('[IndexedDB] ❌ Recovery failed:', recoveryErr);
            }
        }

        console.error('[IndexedDB] 💨 Falling back to Memory Storage (Mock)');
        isUsingMock = true;
        const mock = createMockDatabase();
        db.dailyRecords = mock.dailyRecords;
        db.catalogs = mock.catalogs;
        db.errorLogs = mock.errorLogs;
        db.auditLogs = mock.auditLogs;
    } finally {
        isOpening = false;
    }
};

// ============================================================================
// Error Log Operations
// ============================================================================

export const saveErrorLog = async (log: ErrorLog): Promise<void> => {
    try {
        await ensureDbReady();
        await db.errorLogs.add(log);
    } catch (err) {
        console.warn('Failed to save error log to IndexedDB:', err);
    }
};

export const getErrorLogs = async (limit = 50): Promise<ErrorLog[]> => {
    try {
        await ensureDbReady();
        return await db.errorLogs
            .orderBy('timestamp')
            .reverse()
            .limit(limit)
            .toArray();
    } catch (err) {
        console.error('Failed to retrieve error logs:', err);
        return [];
    }
};

export const clearErrorLogs = async (): Promise<void> => {
    try {
        await ensureDbReady();
        await db.errorLogs.clear();
    } catch (err) {
        console.warn('Failed to clear error logs:', err);
    }
};

// ============================================================================
// Daily Records Operations
// ============================================================================

export const getAllRecords = async (): Promise<Record<string, DailyRecord>> => {
    try {
        await ensureDbReady();
        const records = await db.dailyRecords.toArray();
        const result: Record<string, DailyRecord> = {};
        for (const record of records) {
            result[record.date] = record;
        }
        return result;
    } catch (err) {
        console.error('Failed to get all records from IndexedDB:', err);
        return {};
    }
};

export const getRecordsForMonth = async (year: number, month: number): Promise<DailyRecord[]> => {
    try {
        await ensureDbReady();
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        return await db.dailyRecords
            .where('date')
            .startsWith(prefix)
            .toArray();
    } catch (err) {
        console.error(`Failed to get records for month ${year}-${month}:`, err);
        return [];
    }
};

export const getRecordForDate = async (date: string): Promise<DailyRecord | null> => {
    try {
        await ensureDbReady();
        const record = await db.dailyRecords.get(date);
        return record || null;
    } catch (err) {
        console.error(`Failed to get record for ${date}:`, err);
        return null;
    }
};

export const saveRecord = async (record: DailyRecord): Promise<void> => {
    try {
        await ensureDbReady();
        await db.dailyRecords.put(record);
    } catch (err) {
        console.error('Failed to save record to IndexedDB:', err);
    }
};

export const deleteRecord = async (date: string): Promise<void> => {
    try {
        await ensureDbReady();
        await db.dailyRecords.delete(date);
    } catch (err) {
        console.error('Failed to delete record from IndexedDB:', err);
    }
};

export const getAllDates = async (): Promise<string[]> => {
    try {
        await ensureDbReady();
        const records = await db.dailyRecords.orderBy('date').reverse().keys();
        return records as string[];
    } catch (err) {
        console.error('Failed to get all dates from IndexedDB:', err);
        return [];
    }
};

export const getPreviousDayRecord = async (currentDate: string): Promise<DailyRecord | null> => {
    try {
        await ensureDbReady();
        const record = await db.dailyRecords
            .where('date')
            .below(currentDate)
            .reverse()
            .first();
        return record || null;
    } catch (err) {
        console.error('Failed to get previous day record:', err);
        return null;
    }
};

export const clearAllRecords = async (): Promise<void> => {
    try {
        await ensureDbReady();
        await db.dailyRecords.clear();
    } catch (err) {
        console.error('Failed to clear all records from IndexedDB:', err);
    }
};

// ============================================================================
// Audit Log Operations
// ============================================================================

export const saveAuditLog = async (log: AuditLogEntry): Promise<void> => {
    try {
        await ensureDbReady();
        await db.auditLogs.put(log); // put handles update if id exists
    } catch (err) {
        console.warn('Failed to save audit log to IndexedDB:', err);
    }
};

export const getAuditLogs = async (limitCount = 100): Promise<AuditLogEntry[]> => {
    try {
        await ensureDbReady();
        return await db.auditLogs
            .orderBy('timestamp')
            .reverse()
            .limit(limitCount)
            .toArray();
    } catch (err) {
        console.error('Failed to retrieve audit logs from IndexedDB:', err);
        return [];
    }
};

export const clearAuditLogs = async (): Promise<void> => {
    try {
        await ensureDbReady();
        await db.auditLogs.clear();
    } catch (err) {
        console.error('Failed to clear audit logs from IndexedDB:', err);
    }
};

export const getAuditLogsForDate = async (date: string): Promise<AuditLogEntry[]> => {
    try {
        await ensureDbReady();
        return await db.auditLogs
            .where('recordDate')
            .equals(date)
            .toArray();
    } catch (err) {
        console.error(`Failed to get audit logs for date ${date}:`, err);
        return [];
    }
};

// ============================================================================
// Demo Records Operations
// ============================================================================

export const saveDemoRecord = async (record: DailyRecord): Promise<void> => {
    try {
        await ensureDbReady();
        await db.demoRecords.put(record);
    } catch (err) {
        console.error('[IndexedDB] Failed to save demo record:', err);
    }
};

export const getDemoRecordForDate = async (date: string): Promise<DailyRecord | null> => {
    try {
        await ensureDbReady();
        const record = await db.demoRecords.get(date);
        return record || null;
    } catch (err) {
        console.error(`[IndexedDB] Failed to get demo record for ${date}:`, err);
        return null;
    }
};

export const getAllDemoRecords = async (): Promise<Record<string, DailyRecord>> => {
    try {
        await ensureDbReady();
        const records = await db.demoRecords.toArray();
        const result: Record<string, DailyRecord> = {};
        for (const record of records) {
            result[record.date] = record;
        }
        return result;
    } catch (err) {
        console.error('[IndexedDB] Failed to get all demo records:', err);
        return {};
    }
};

export const deleteDemoRecord = async (date: string): Promise<void> => {
    try {
        await ensureDbReady();
        await db.demoRecords.delete(date);
    } catch (err) {
        console.error('[IndexedDB] Failed to delete demo record:', err);
    }
};

export const clearAllDemoRecords = async (): Promise<void> => {
    try {
        await ensureDbReady();
        await db.demoRecords.clear();
    } catch (err) {
        console.error('[IndexedDB] Failed to clear all demo records:', err);
    }
};

export const getPreviousDemoDayRecord = async (currentDate: string): Promise<DailyRecord | null> => {
    try {
        await ensureDbReady();
        const record = await db.demoRecords
            .where('date')
            .below(currentDate)
            .reverse()
            .first();
        return record || null;
    } catch (err) {
        console.error('[IndexedDB] Failed to get previous demo day record:', err);
        return null;
    }
};

// ============================================================================
// Catalog Operations (Nurses, TENS)
// ============================================================================

export const getCatalog = async (catalogId: string): Promise<string[]> => {
    try {
        await ensureDbReady();
        const catalog = await db.catalogs.get(catalogId);
        return catalog?.list || [];
    } catch (err) {
        console.error(`Failed to get catalog ${catalogId}:`, err);
        return [];
    }
};

export const saveCatalog = async (catalogId: string, list: string[]): Promise<void> => {
    try {
        await ensureDbReady();
        await db.catalogs.put({
            id: catalogId,
            list,
            lastUpdated: new Date().toISOString()
        });
    } catch (err) {
        console.error(`Failed to save catalog ${catalogId}:`, err);
    }
};

// ============================================================================
// Migration from localStorage
// ============================================================================

const STORAGE_KEY = 'hanga_roa_hospital_data';
const NURSES_KEY = 'hanga_roa_nurses_list';
const TENS_KEY = 'hanga_roa_tens_list';
const AUDIT_KEY = 'hanga_roa_audit_logs';
const DEMO_KEY = 'hhr_demo_records';
const MIGRATION_FLAG = 'indexeddb_migration_complete';

export const migrateFromLocalStorage = async (): Promise<boolean> => {
    if (localStorage.getItem(MIGRATION_FLAG) === 'true') {
        return false;
    }

    console.info('🔄 Starting migration from localStorage to IndexedDB...');

    try {
        await ensureDbReady();
        // Migrate daily records
        const recordsData = localStorage.getItem(STORAGE_KEY);
        if (recordsData) {
            const records = JSON.parse(recordsData) as Record<string, DailyRecord>;
            const recordArray = Object.values(records);
            if (recordArray.length > 0) {
                await db.dailyRecords.bulkPut(recordArray);
                console.info(`✅ Migrated ${recordArray.length} daily records`);
            }
        }

        // Migrate nurses list
        const nursesData = localStorage.getItem(NURSES_KEY);
        if (nursesData) {
            const nurses = JSON.parse(nursesData) as string[];
            await saveCatalog('nurses', nurses);
            console.info(`✅ Migrated nurses catalog (${nurses.length} entries)`);
        }

        // Migrate TENS list
        const tensData = localStorage.getItem(TENS_KEY);
        if (tensData) {
            const tens = JSON.parse(tensData) as string[];
            await saveCatalog('tens', tens);
            console.info(`✅ Migrated TENS catalog (${tens.length} entries)`);
        }

        // Migrate audit logs
        const auditData = localStorage.getItem(AUDIT_KEY);
        if (auditData) {
            const logs = JSON.parse(auditData) as AuditLogEntry[];
            if (logs.length > 0) {
                await db.auditLogs.bulkPut(logs);
                console.info(`✅ Migrated ${logs.length} audit logs`);
            }
        }

        // Migrate demo records
        const demoData = localStorage.getItem(DEMO_KEY);
        if (demoData) {
            const records = JSON.parse(demoData) as Record<string, DailyRecord>;
            const recordArray = Object.values(records);
            if (recordArray.length > 0) {
                await db.demoRecords.bulkPut(recordArray);
                console.info(`✅ Migrated ${recordArray.length} demo records`);
            }
        }

        localStorage.setItem(MIGRATION_FLAG, 'true');
        console.info('✅ Migration complete!');

        return true;
    } catch (error) {
        console.error('❌ Migration failed:', error);
        return false;
    }
};

export const isIndexedDBAvailable = (): boolean => {
    return typeof indexedDB !== 'undefined';
};

export const isDatabaseInFallbackMode = (): boolean => {
    return isUsingMock;
};

/**
 * Hard Reset: Clears all local storage (IndexedDB, localStorage, sessionStorage)
 * Use only as last resort for corruption issues.
 */
export const resetLocalDatabase = async () => {
    try {
        const dbs = await window.indexedDB.databases();
        for (const dbInfo of dbs) {
            if (dbInfo.name) {
                window.indexedDB.deleteDatabase(dbInfo.name);
            }
        }
    } catch (e) {
        console.error('Failed to clear IndexedDB databases:', e);
    }
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
};

/**
 * Settings Store
 */
export const saveSetting = async (id: string, value: unknown): Promise<void> => {
    try {
        await db.settings.put({ id, value });
    } catch (e) {
        console.error(`[IndexedDB] Failed to save setting ${id}:`, e);
    }
};

export const getSetting = async <T>(id: string, defaultValue: T): Promise<T> => {
    try {
        const item = await db.settings.get(id);
        return item ? (item.value as T) : defaultValue;
    } catch (e) {
        console.error(`[IndexedDB] Failed to get setting ${id}:`, e);
        return defaultValue;
    }
};

export const clearCatalog = async (catalogId: string): Promise<void> => {
    try {
        await ensureDbReady();
        await db.catalogs.delete(catalogId);
    } catch (err) {
        console.error(`Failed to clear catalog ${catalogId}:`, err);
    }
};

export const clearAllSettings = async (): Promise<void> => {
    try {
        await ensureDbReady();
        await db.settings.clear();
    } catch (err) {
        console.error('[IndexedDB] Failed to clear all settings:', err);
    }
};

export { db as hospitalDB };
