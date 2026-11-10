import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalDatabase } from '@/services/storage/indexeddb/indexedDbMaintenanceService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const patchKey = 'hhr_pending_daily_record_patches_v1';
const outboxKey = 'hhr_audit_connection_outbox_v1:synthetic';
const seedDatabase = (store = 'syncQueue', status = 'PENDING'): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('HangaRoaDB');
    request.onupgradeneeded = () => {
      request.result.createObjectStore('syncQueue', { keyPath: 'id' });
      request.result.createObjectStore('dailyRecords', { keyPath: 'date' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, 'readwrite');
      if (status !== 'EMPTY')
        tx.objectStore(store).put({
          id: 1,
          date: '2026-11-10',
          status,
          payload: { synthetic: true },
        });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });

const deleteDatabase = (): Promise<void> =>
  new Promise(resolve => {
    const request = indexedDB.deleteDatabase('HangaRoaDB');
    request.onsuccess = () => resolve();
  });

describe('manual storage reset', () => {
  beforeEach(async () => {
    await deleteDatabase();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(defaultBrowserWindowRuntime, 'reload').mockImplementation(() => undefined);
    vi.spyOn(defaultBrowserWindowRuntime, 'confirm').mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the pending patch and durable task when the person has not confirmed their loss', async () => {
    await seedDatabase();
    localStorage.setItem(patchKey, '{"synthetic":true}');
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase');
    await resetLocalDatabase();
    expect(localStorage.getItem(patchKey)).toBe('{"synthetic":true}');
    expect(deletion).not.toHaveBeenCalled();
    expect(defaultBrowserWindowRuntime.reload).not.toHaveBeenCalled();
  });

  it('deletes the database only after confirmation and always keeps patches, audit outbox and legacy queue', async () => {
    await seedDatabase();
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of [patchKey, outboxKey, 'offlineQueue']) storage.setItem(key, 'synthetic');
      storage.setItem('hhr_disposable_cache', 'stale');
      storage.setItem('unrelated', 'keep');
    }
    vi.mocked(defaultBrowserWindowRuntime.confirm).mockReturnValue(true);
    await resetLocalDatabase();
    expect((await indexedDB.databases()).some(db => db.name === 'HangaRoaDB')).toBe(false);
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of [patchKey, outboxKey, 'offlineQueue'])
        expect(storage.getItem(key)).toBe('synthetic');
      expect(storage.getItem('hhr_disposable_cache')).toBeNull();
      expect(storage.getItem('unrelated')).toBe('keep');
    }
    expect(defaultBrowserWindowRuntime.reload).toHaveBeenCalledOnce();
  });

  it('asks before every reset, because nothing local proves the database holds no unsent change', async () => {
    await seedDatabase('syncQueue', 'EMPTY');
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase');
    await resetLocalDatabase();
    expect(defaultBrowserWindowRuntime.confirm).toHaveBeenCalledWith(
      expect.stringContaining('esos cambios se pierden')
    );
    expect(deletion).not.toHaveBeenCalled();
    expect(defaultBrowserWindowRuntime.reload).not.toHaveBeenCalled();
  });
});
