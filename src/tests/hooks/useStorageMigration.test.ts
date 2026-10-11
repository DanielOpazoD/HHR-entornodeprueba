import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useStorageMigration } from '@/hooks/useStorageMigration';
import * as storageCore from '@/services/storage/indexeddb/indexedDbCore';
import * as storageMigration from '@/services/storage/indexeddb/indexedDbMigrationService';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  isIndexedDBAvailable: vi.fn(),
  isDatabaseInFallbackMode: vi.fn(),
  getLocalPersistenceRuntimeSnapshot: vi.fn(),
  registerDatabaseRecreatedHandler: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbMigrationService', () => ({
  migrateFromLocalStorage: vi.fn(),
}));

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useStorageMigration', () => {
  let consoleSpies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpies = suppressConsole(['warn', 'error']);
  });

  afterEach(() => {
    restoreConsole(consoleSpies);
  });

  it('should complete startup migration when enabled', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
    vi.mocked(storageMigration.migrateFromLocalStorage).mockResolvedValue(false);

    const { result } = renderHook(() => useStorageMigration());

    await waitFor(() => {
      expect(result.current.isComplete).toBe(true);
    });

    expect(result.current.isMigrating).toBe(false);
  });

  it('should stay idle when disabled', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);

    const { result } = renderHook(() => useStorageMigration({ enabled: false }));

    expect(result.current.isComplete).toBe(true);
    expect(result.current.isMigrating).toBe(false);
    expect(result.current.didMigrate).toBe(false);
    expect(storageMigration.migrateFromLocalStorage).not.toHaveBeenCalled();
  });

  it('should complete migration successfully when IndexedDB is available', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
    vi.mocked(storageMigration.migrateFromLocalStorage).mockResolvedValue(true);

    const { result } = renderHook(() => useStorageMigration());

    await waitFor(() => {
      expect(result.current.didMigrate).toBe(true);
    });

    expect(result.current.isMigrating).toBe(false);
    expect(result.current.didMigrate).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should skip migration when IndexedDB is not available', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(false);

    const { result } = renderHook(() => useStorageMigration());

    await waitFor(() => {
      expect(result.current.isComplete).toBe(true);
    });

    expect(result.current.isMigrating).toBe(false);
    expect(result.current.didMigrate).toBe(false);
    expect(storageMigration.migrateFromLocalStorage).not.toHaveBeenCalled();
  });

  it('should handle migration errors gracefully', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
    vi.mocked(storageMigration.migrateFromLocalStorage).mockRejectedValue(
      new Error('Migration failed')
    );

    const { result } = renderHook(() => useStorageMigration());

    await waitFor(() => {
      expect(result.current.isComplete).toBe(true);
    });

    expect(result.current.isMigrating).toBe(false);
    expect(result.current.didMigrate).toBe(false);
    expect(result.current.error).toBe('Migration failed');
  });

  it('should handle non-Error exceptions', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
    vi.mocked(storageMigration.migrateFromLocalStorage).mockRejectedValue('String error');

    const { result } = renderHook(() => useStorageMigration());

    await waitFor(() => {
      expect(result.current.error).toBe('Unknown error');
    });

    expect(result.current.error).toBe('Unknown error');
  });

  it.each([true, false])(
    'completes after StrictMode replay with enabled initially %s',
    async initiallyEnabled => {
      vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
      const migration = createDeferred<boolean>();
      vi.mocked(storageMigration.migrateFromLocalStorage).mockReturnValue(migration.promise);
      const { result, rerender } = renderHook(({ enabled }) => useStorageMigration({ enabled }), {
        initialProps: { enabled: initiallyEnabled },
        reactStrictMode: true,
      });
      if (!initiallyEnabled) rerender({ enabled: true });
      await act(async () => {
        migration.resolve(true);
      });
      expect(result.current).toEqual({
        isComplete: true,
        isMigrating: false,
        didMigrate: true,
        error: null,
      });
      expect(storageMigration.migrateFromLocalStorage).toHaveBeenCalledTimes(1);
    }
  );

  it('reuses a pending migration across disabling and re-enabling', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
    const migration = createDeferred<boolean>();
    vi.mocked(storageMigration.migrateFromLocalStorage).mockReturnValue(migration.promise);
    const { result, rerender } = renderHook(({ enabled }) => useStorageMigration({ enabled }), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });
    expect(result.current.isMigrating).toBe(false);
    rerender({ enabled: true });
    await act(async () => {
      migration.resolve(true);
    });
    expect(result.current.didMigrate).toBe(true);
    expect(result.current.isMigrating).toBe(false);
    expect(storageMigration.migrateFromLocalStorage).toHaveBeenCalledTimes(1);
  });
  it('ignores a disabled run and permits a fresh attempt after it settles', async () => {
    vi.mocked(storageCore.isIndexedDBAvailable).mockReturnValue(true);
    const migration = createDeferred<boolean>();
    vi.mocked(storageMigration.migrateFromLocalStorage)
      .mockReturnValueOnce(migration.promise)
      .mockResolvedValueOnce(false);
    const { result, rerender } = renderHook(({ enabled }) => useStorageMigration({ enabled }), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });
    await act(async () => {
      migration.reject(new Error('stale failure'));
    });
    expect(result.current.error).toBeNull();
    expect(result.current.didMigrate).toBe(false);
    await act(async () => {
      rerender({ enabled: true });
    });
    expect(result.current.isComplete).toBe(true);
    expect(result.current.error).toBeNull();
    expect(storageMigration.migrateFromLocalStorage).toHaveBeenCalledTimes(2);
  });
});
