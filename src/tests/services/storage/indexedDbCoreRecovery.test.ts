import { describe, expect, it, vi } from 'vitest';
import {
  recoverIndexedDbInitialOpenRuntimeFailure,
  restoreIndexedDbFromMockFallback,
} from '@/services/storage/indexeddb/indexedDbCoreRecovery';
import type { IndexedDbDatabaseLike } from '@/services/storage/indexeddb/indexedDbContracts';

const createDatabase = (name: string): IndexedDbDatabaseLike =>
  ({
    name,
  }) as unknown as IndexedDbDatabaseLike;

describe('indexedDbCoreRecovery', () => {
  it('recreates the real database and resets recovery tracking after mock fallback', () => {
    const currentDatabase = createDatabase('mock-shell');
    const realDatabase = createDatabase('real');
    const attachDatabaseEvents = vi.fn();
    const resetRecoveryTracking = vi.fn();

    const outcome = restoreIndexedDbFromMockFallback({
      currentDatabase,
      createDatabase: () => realDatabase,
      attachDatabaseEvents,
      resetRecoveryTracking,
      assignMockTables: vi.fn(),
      createMockDatabase: vi.fn(),
      recordRecoveryFailure: vi.fn(),
    });

    expect(outcome).toEqual({
      database: realDatabase,
      fallbackMode: false,
    });
    expect(attachDatabaseEvents).toHaveBeenCalledWith(realDatabase);
    expect(resetRecoveryTracking).toHaveBeenCalled();
  });

  it('keeps the active database in mock fallback when recreation fails', () => {
    const currentDatabase = createDatabase('mock-shell');
    const mockDatabase = createDatabase('mock-tables');
    const constructionError = new Error('indexeddb unavailable');
    const assignMockTables = vi.fn();
    const recordRecoveryFailure = vi.fn();

    const outcome = restoreIndexedDbFromMockFallback({
      currentDatabase,
      createDatabase: () => {
        throw constructionError;
      },
      attachDatabaseEvents: vi.fn(),
      resetRecoveryTracking: vi.fn(),
      assignMockTables,
      createMockDatabase: () => mockDatabase,
      recordRecoveryFailure,
    });

    expect(outcome).toEqual({
      database: currentDatabase,
      fallbackMode: true,
    });
    expect(recordRecoveryFailure).toHaveBeenCalledWith(constructionError);
    expect(assignMockTables).toHaveBeenCalledWith(currentDatabase, mockDatabase);
  });

  it('wraps initial open recovery around the in-memory fallback of the runtime database', async () => {
    const currentDatabase = createDatabase('current');
    const activateMockFallback = vi.fn(() => currentDatabase);

    const outcome = await recoverIndexedDbInitialOpenRuntimeFailure({
      error: { name: 'VersionError', message: 'newer schema' },
      database: currentDatabase,
      activateMockFallback,
    });

    expect(activateMockFallback).toHaveBeenCalledTimes(1);
    expect(outcome.database).toBe(currentDatabase);
    expect(outcome.fallbackMode).toBe(true);
    expect(outcome.shouldScheduleBackgroundRecovery).toBe(true);
  });
});
