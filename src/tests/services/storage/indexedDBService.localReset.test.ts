import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DATABASES_KEPT_BY_AUTOMATIC_REPAIR,
  STORAGE_KEYS_KEPT_BY_AUTOMATIC_REPAIR,
  STORAGE_PREFIXES_KEPT_BY_AUTOMATIC_REPAIR,
  repairClientStorageKeepingPendingWork,
  resetLocalDatabase,
} from '@/services/storage/indexeddb/indexedDbMaintenanceService';
import { PENDING_DAILY_RECORD_PATCH_STORAGE_KEY } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { AUDIT_CONNECTION_OUTBOX_PREFIX } from '@/services/admin/auditSession/auditConnectionOutbox';
import { BOOTSTRAP_RECOVERY_KEY } from '@/services/config/clientBootstrapRecovery';

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

describe('Local App Reset', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    // The manual reset asks first; these cases cover what it does once the person accepts.
    window.confirm = vi.fn(() => true);
  });

  it('should clear all and reload (mocked reload)', async () => {
    // Mock location.reload
    const originalLocation = setMockLocationWithReload();

    // Mock indexedDB.databases since it might not be in JSDOM / fake-indexeddb
    const originalDatabases = window.indexedDB.databases;
    window.indexedDB.databases = vi.fn().mockResolvedValue([{ name: 'HangaRoaDB' }]);
    const originalDelete = window.indexedDB.deleteDatabase;
    window.indexedDB.deleteDatabase = vi.fn();

    await resetLocalDatabase();

    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
    expect(window.location.reload).toHaveBeenCalled();

    // Restore
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDelete;
  });

  it('repairs local storage without touching unsynced clinical work or its own markers', async () => {
    const originalLocation = setMockLocationWithReload();

    const originalDatabases = window.indexedDB.databases;
    window.indexedDB.databases = vi
      .fn()
      .mockResolvedValue([
        { name: 'HangaRoaDB' },
        { name: 'firebaseLocalStorageDb' },
        { name: 'firestore/[DEFAULT]/hhr-test/main' },
      ]);
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
    localStorage.setItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY, '{"2026-10-22":["patch"]}');
    localStorage.setItem('offlineQueue', '[{"id":"legacy"}]');
    localStorage.setItem(`${AUDIT_CONNECTION_OUTBOX_PREFIX}evt-1`, '{"id":"evt-1"}');
    localStorage.setItem('hhr_firebase_config', '{"stale":true}');
    sessionStorage.setItem('hhr_bootstrap_storage_repair_v1', '1');
    sessionStorage.setItem(BOOTSTRAP_RECOVERY_KEY, '1');
    sessionStorage.setItem('hhr_logged_this_session', 'true');

    await repairClientStorageKeepingPendingWork();

    expect(unregister).toHaveBeenCalled();
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith(
      'firestore/[DEFAULT]/hhr-test/main'
    );
    expect(window.indexedDB.deleteDatabase).not.toHaveBeenCalledWith('HangaRoaDB');
    expect(localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toBe(
      '{"2026-10-22":["patch"]}'
    );
    expect(localStorage.getItem('offlineQueue')).toBe('[{"id":"legacy"}]');
    expect(localStorage.getItem(`${AUDIT_CONNECTION_OUTBOX_PREFIX}evt-1`)).toBe('{"id":"evt-1"}');
    expect(localStorage.getItem('firebase:authUser:test:[DEFAULT]')).toBe('{"uid":"abc"}');
    expect(sessionStorage.getItem('hhr_bootstrap_storage_repair_v1')).toBe('1');
    expect(sessionStorage.getItem(BOOTSTRAP_RECOVERY_KEY)).toBe('1');
    expect(localStorage.getItem('hhr_firebase_config')).toBeNull();
    expect(sessionStorage.getItem('hhr_logged_this_session')).toBeNull();
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

  it("keeps exactly the stores that hold pending work under their owners' names", () => {
    expect(DATABASES_KEPT_BY_AUTOMATIC_REPAIR).toContain('HangaRoaDB');
    expect(STORAGE_KEYS_KEPT_BY_AUTOMATIC_REPAIR.has(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toBe(
      true
    );
    expect(STORAGE_KEYS_KEPT_BY_AUTOMATIC_REPAIR.has(BOOTSTRAP_RECOVERY_KEY)).toBe(true);
    expect(STORAGE_PREFIXES_KEPT_BY_AUTOMATIC_REPAIR).toContain(AUDIT_CONNECTION_OUTBOX_PREFIX);
  });

  it('falls back to known app IndexedDB databases when database enumeration is unavailable during manual local reset', async () => {
    const originalLocation = setMockLocationWithReload();

    const originalDatabases = window.indexedDB.databases;
    window.indexedDB.databases = vi.fn().mockRejectedValue(new Error('databases unavailable'));
    const originalDelete = window.indexedDB.deleteDatabase;
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

    await resetLocalDatabase();

    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    expect(window.location.reload).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDelete;
  });

  it('waits for IndexedDB deletion before reloading during manual local reset', async () => {
    const originalLocation = setMockLocationWithReload();

    const originalDatabases = window.indexedDB.databases;
    window.indexedDB.databases = vi.fn().mockResolvedValue([{ name: 'firebaseLocalStorageDb' }]);
    const originalDelete = window.indexedDB.deleteDatabase;
    let succeedDelete!: () => void;
    const deleteRequest = {
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
      onblocked: null as null | (() => void),
    };
    window.indexedDB.deleteDatabase = vi.fn(() => {
      succeedDelete = () => deleteRequest.onsuccess?.();
      return deleteRequest as unknown as IDBOpenDBRequest;
    });

    const resetPromise = resetLocalDatabase();
    await vi.waitFor(() => {
      expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    });

    expect(window.location.reload).not.toHaveBeenCalled();

    succeedDelete();
    await resetPromise;

    expect(window.location.reload).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDelete;
  });

  it('clears disposable browser storage after IndexedDB deletion times out during manual local reset', async () => {
    vi.useFakeTimers();
    const originalLocation = setMockLocationWithReload();

    const originalDatabases = window.indexedDB.databases;
    window.indexedDB.databases = vi.fn().mockResolvedValue([{ name: 'firebaseLocalStorageDb' }]);
    const originalDelete = window.indexedDB.deleteDatabase;
    const deleteRequest = {
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
      onblocked: null as null | (() => void),
    };
    window.indexedDB.deleteDatabase = vi.fn(() => deleteRequest as unknown as IDBOpenDBRequest);
    localStorage.setItem('hhr_stale_cache', 'remove-me');
    sessionStorage.setItem('hhr_stale_cache', 'remove-me');

    const resetPromise = resetLocalDatabase();
    await vi.waitFor(() => {
      expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    });

    expect(window.location.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);
    await resetPromise;

    expect(localStorage.getItem('hhr_stale_cache')).toBeNull();
    expect(sessionStorage.getItem('hhr_stale_cache')).toBeNull();
    expect(window.location.reload).toHaveBeenCalled();

    vi.useRealTimers();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDelete;
  });
});
