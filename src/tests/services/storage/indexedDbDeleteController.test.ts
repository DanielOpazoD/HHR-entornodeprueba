import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearIndexedDatabases } from '@/services/storage/indexeddb/indexedDbDeleteController';

describe('indexedDbDeleteController', () => {
  const originalDatabases = window.indexedDB.databases;
  const originalDeleteDatabase = window.indexedDB.deleteDatabase;

  afterEach(() => {
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDeleteDatabase;
    vi.restoreAllMocks();
  });

  it('deletes enumerated and known IndexedDB databases without duplicating names', async () => {
    window.indexedDB.databases = vi
      .fn()
      .mockResolvedValue([{ name: 'HangaRoaDB' }, { name: 'customLocalDb' }]);
    window.indexedDB.deleteDatabase = vi.fn(() => {
      const request = {
        error: null,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onblocked: null as null | (() => void),
      };
      queueMicrotask(() => request.onsuccess?.());
      return request as unknown as IDBOpenDBRequest;
    });

    await clearIndexedDatabases();

    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledTimes(3);
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('customLocalDb');
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
  });
});
