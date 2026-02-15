import Dexie, { Table } from 'dexie';

import { DailyRecord } from '@/types';
import { AuditLogEntry } from '@/types/audit';
import { ErrorLog } from '@/services/utils/errorService';

import { SyncTask } from '../syncQueueTypes';

export class HangaRoaDatabase extends Dexie {
  dailyRecords!: Table<DailyRecord>;
  demoRecords!: Table<DailyRecord>;
  catalogs!: Table<{ id: string; list: string[]; lastUpdated: string }>;
  errorLogs!: Table<ErrorLog>;
  auditLogs!: Table<AuditLogEntry>;
  settings!: Table<{ id: string; value: unknown }>;
  syncQueue!: Table<SyncTask>;

  constructor() {
    super('HangaRoaDB');

    this.version(7).stores({
      dailyRecords: 'date',
      demoRecords: 'date',
      catalogs: 'id',
      errorLogs: 'id, timestamp, severity',
      auditLogs: 'id, timestamp, action, entityId, recordDate',
      settings: 'id',
      syncQueue: '++id, status, timestamp, type, key, nextAttemptAt',
    });
  }
}

export const createMockDatabase = (): HangaRoaDatabase => {
  const memoryStore: Record<string, Map<string, unknown>> = {
    dailyRecords: new Map<string, unknown>(),
    demoRecords: new Map<string, unknown>(),
    catalogs: new Map<string, unknown>(),
    errorLogs: new Map<string, unknown>(),
    auditLogs: new Map<string, unknown>(),
    settings: new Map<string, unknown>(),
    syncQueue: new Map<string, unknown>(),
  };

  const createMockTable = (tableName: string) => ({
    toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values())),
    get: (key: string) => Promise.resolve(memoryStore[tableName].get(key) || null),
    put: (item: Record<string, unknown>) => {
      const key = (item.date as string) || (item.id as string) || 'default';
      memoryStore[tableName].set(key, item);
      return Promise.resolve(key);
    },
    delete: (key: string) => {
      memoryStore[tableName].delete(key);
      return Promise.resolve();
    },
    clear: () => {
      memoryStore[tableName].clear();
      return Promise.resolve();
    },
    bulkPut: (items: Record<string, unknown>[]) => {
      items.forEach(item => {
        const key = (item.date as string) || (item.id as string) || 'default';
        memoryStore[tableName].set(key, item);
      });
      return Promise.resolve('');
    },
    update: (id: string, changes: Record<string, unknown>) => {
      const existing = Array.from(memoryStore[tableName].values()).find(item => {
        const currentItem = item as Record<string, unknown>;
        return (currentItem.id || currentItem.date) === id;
      }) as Record<string, unknown> | undefined;

      if (existing) {
        Object.assign(existing, changes);
      }

      return Promise.resolve(existing ? 1 : 0);
    },
    add: (item: Record<string, unknown>) => {
      const id = (item.id as string) || Math.random().toString();
      const newItem = { ...item, id };
      memoryStore[tableName].set(id, newItem);
      return Promise.resolve(id);
    },
    orderBy: (_keyPath: string) => ({
      reverse: () => ({
        limit: (n: number) => ({
          toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values()).slice(0, n)),
        }),
        keys: () => Promise.resolve(Array.from(memoryStore[tableName].keys())),
        toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values())),
      }),
      toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values())),
    }),
    where: (keyName: string) => ({
      below: (val: string) => ({
        reverse: () => ({
          first: () => {
            const sortedKeys = Array.from(memoryStore[tableName].keys()).sort();
            const targetKey = sortedKeys.reverse().find(k => k < val);
            return Promise.resolve(targetKey ? memoryStore[tableName].get(targetKey) : null);
          },
        }),
      }),
      equals: (val: unknown) => ({
        first: () => Promise.resolve(memoryStore[tableName].get(val as string) || null),
        count: () =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values()).filter(
              item => (item as Record<string, unknown>)[keyName] === val
            ).length
          ),
        toArray: () =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values()).filter(
              item => (item as Record<string, unknown>)[keyName] === val
            )
          ),
        sortBy: (sortKey: string) =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values())
              .filter(item => (item as Record<string, unknown>)[keyName] === val)
              .sort((a, b) => {
                const valueA = (a as Record<string, unknown>)[sortKey];
                const valueB = (b as Record<string, unknown>)[sortKey];
                if (typeof valueA === 'string' && typeof valueB === 'string') {
                  return valueA.localeCompare(valueB);
                }
                if (typeof valueA === 'number' && typeof valueB === 'number') {
                  return valueA - valueB;
                }
                return 0;
              })
          ),
      }),
      startsWith: (prefix: string) => ({
        toArray: () =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values()).filter(item =>
              String((item as Record<string, unknown>)[keyName] || '').startsWith(prefix)
            )
          ),
      }),
    }),
  });

  return {
    dailyRecords: createMockTable('dailyRecords'),
    demoRecords: createMockTable('demoRecords'),
    catalogs: createMockTable('catalogs'),
    errorLogs: createMockTable('errorLogs'),
    auditLogs: createMockTable('auditLogs'),
    settings: createMockTable('settings'),
    syncQueue: createMockTable('syncQueue'),
    isOpen: () => true,
    open: () => Promise.resolve(),
    on: () => ({}),
  } as unknown as HangaRoaDatabase;
};

let db: HangaRoaDatabase;
let isUsingMock = false;
let isOpening = false;
let onDatabaseRecreated: (() => void) | null = null;

const attachDatabaseEvents = (database: HangaRoaDatabase) => {
  database.on('blocked', () => {
    console.warn('[IndexedDB] ⏳ Database is blocked by another tab');
  });

  database.on('close', () => {
    console.warn('[IndexedDB] 🚪 Database connection closed unexpectedly.');
  });
};

const initializeDatabase = () => {
  try {
    db = new HangaRoaDatabase();
    attachDatabaseEvents(db);
  } catch (error) {
    console.error('[IndexedDB] ❌ Failed to construct HangaRoaDatabase:', error);
    db = createMockDatabase();
    isUsingMock = true;
    console.error('[IndexedDB] !!! USING MOCK DATABASE !!! Data will be lost on reload.');
  }
};

const assignMockTables = (mock: HangaRoaDatabase) => {
  db.dailyRecords = mock.dailyRecords;
  db.demoRecords = mock.demoRecords;
  db.catalogs = mock.catalogs;
  db.errorLogs = mock.errorLogs;
  db.auditLogs = mock.auditLogs;
  db.settings = mock.settings;
  db.syncQueue = mock.syncQueue;
};

initializeDatabase();

export const registerDatabaseRecreatedHandler = (handler: () => void): void => {
  onDatabaseRecreated = handler;
};

export const ensureDbReady = async (): Promise<void> => {
  if (typeof window !== 'undefined' && window.__HHR_E2E_OVERRIDE__) {
    isUsingMock = true;
    return;
  }

  if (isUsingMock) return;

  if (db.isOpen()) {
    try {
      await db.settings.get('__health_check__');
      return;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { name?: string }).name === 'DatabaseClosedError'
      ) {
        console.warn('[IndexedDB] 🔄 Detected DatabaseClosedError, attempting to re-open...');
      } else {
        return;
      }
    }
  }

  if (isOpening) {
    let attempts = 0;
    while (isOpening && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
      if (db.isOpen() || isUsingMock) return;
    }
    if (isOpening) {
      console.warn('[IndexedDB] ⏳ Still opening after 5s, forcing fallback');
      isUsingMock = true;
      return;
    }
    return;
  }

  isOpening = true;
  try {
    const openPromise = db.open();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IndexedDB open timeout')), 2500)
    );
    await Promise.race([openPromise, timeoutPromise]);
  } catch (error: unknown) {
    const errorName =
      error && typeof error === 'object' && 'name' in error ? String(error.name) : 'Unknown';
    const errorMessage =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);

    console.warn(
      '[IndexedDB] ⚠️ Initial open failed, attempting auto-recovery:',
      errorName || errorMessage
    );

    if (errorName === 'UnknownError' || errorName === 'VersionError') {
      try {
        db.close();

        const deletePromise = Dexie.delete('HangaRoaDB');
        const deleteTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Deletion timeout')), 3000)
        );

        await Promise.race([deletePromise, deleteTimeout]);

        db = new HangaRoaDatabase();
        attachDatabaseEvents(db);
        await db.open();

        onDatabaseRecreated?.();
        return;
      } catch (recoveryError) {
        console.error('[IndexedDB] ❌ Recovery failed:', recoveryError);
      }
    }

    console.error('[IndexedDB] 💨 Falling back to Memory Storage (Mock)');
    isUsingMock = true;
    assignMockTables(createMockDatabase());
  } finally {
    isOpening = false;
  }
};

export const isIndexedDBAvailable = (): boolean => typeof indexedDB !== 'undefined';

export const isDatabaseInFallbackMode = (): boolean => isUsingMock;

export { db as hospitalDB };
