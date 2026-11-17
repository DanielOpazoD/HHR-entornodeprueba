// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  assignIndexedDbMockTables,
  createIndexedDbDatabaseOrFallback,
} from '@/services/storage/indexeddb/indexedDbDatabaseLifecycle';
import type {
  IndexedDbDatabaseLike,
  IndexedDbTableMap,
} from '@/services/storage/indexeddb/indexedDbContracts';

const createTable = (name: string) => ({ name });

const createDatabase = (): IndexedDbTableMap =>
  ({
    dailyRecords: createTable('dailyRecords-real'),
    catalogs: createTable('catalogs-real'),
    errorLogs: createTable('errorLogs-real'),
    auditLogs: createTable('auditLogs-real'),
    settings: createTable('settings-real'),
    syncQueue: createTable('syncQueue-real'),
  }) as unknown as IndexedDbTableMap;

const createMockDatabase = (): IndexedDbDatabaseLike =>
  ({
    dailyRecords: createTable('dailyRecords-mock'),
    catalogs: createTable('catalogs-mock'),
    errorLogs: createTable('errorLogs-mock'),
    auditLogs: createTable('auditLogs-mock'),
    settings: createTable('settings-mock'),
    syncQueue: createTable('syncQueue-mock'),
    isOpen: () => true,
    open: () => Promise.resolve(),
    on: () => undefined,
  }) as unknown as IndexedDbDatabaseLike;

describe('indexedDbDatabaseLifecycle', () => {
  it('assigns every mock table to the active database instance', () => {
    const database = createDatabase();
    const mockDatabase = createMockDatabase();

    assignIndexedDbMockTables(database, mockDatabase);

    expect(database).toMatchObject({
      dailyRecords: mockDatabase.dailyRecords,
      catalogs: mockDatabase.catalogs,
      errorLogs: mockDatabase.errorLogs,
      auditLogs: mockDatabase.auditLogs,
      settings: mockDatabase.settings,
      syncQueue: mockDatabase.syncQueue,
    });
  });

  it('activates mock fallback and records telemetry when database construction fails', () => {
    const constructionError = new Error('indexeddb unavailable');
    const mockDatabase = createMockDatabase();
    const recordRecoveryFailure = vi.fn();
    const recordFallbackMode = vi.fn();

    const outcome = createIndexedDbDatabaseOrFallback({
      createDatabase: () => {
        throw constructionError;
      },
      createMockDatabase: () => mockDatabase,
      attachDatabaseEvents: vi.fn(),
      recordRecoveryFailure,
      recordFallbackMode,
      getBudgetSnapshot: () => ({ maxAttempts: 6 }),
    });

    expect(outcome).toEqual({
      database: mockDatabase,
      fallbackMode: true,
    });
    expect(recordRecoveryFailure).toHaveBeenCalledWith(constructionError);
    expect(recordFallbackMode).toHaveBeenCalledWith(
      'construct_failed',
      'IndexedDB no pudo inicializarse y se activo el modo fallback local.',
      { maxAttempts: 6 }
    );
  });
});
