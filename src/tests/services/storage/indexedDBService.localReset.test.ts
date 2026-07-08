import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as idbService from '@/services/storage/indexedDBService';

const FIXED_LOGIN_ATTEMPT_TIMESTAMP = 1772627400000;

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
  });

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
    const originalCaches = Object.getOwnPropertyDescriptor(window, 'caches');
    const deleteCache = vi.fn().mockResolvedValue(true);
    const cacheKeys = vi.fn().mockResolvedValue(['hhr-runtime-cache', 'workbox-precache-v1']);
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: cacheKeys,
        delete: deleteCache,
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations },
    });
    localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');
    localStorage.setItem('firebase:redirectUser:test:[DEFAULT]', '{"uid":"redirect"}');
    localStorage.setItem('hhr_auth_bootstrap_pending_v1', '{"startedAt":1,"mode":"redirect"}');
    localStorage.setItem('unrelated_local_key', 'remove-me');
    sessionStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"session"}');
    sessionStorage.setItem(
      'hhr_google_login_attempt_pending',
      String(FIXED_LOGIN_ATTEMPT_TIMESTAMP)
    );
    sessionStorage.setItem('hhr_logged_this_session', 'true');
    sessionStorage.setItem('unrelated_session_key', 'remove-me');

    await idbService.resetLocalAppStorage();

    expect(getRegistrations).toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
    expect(cacheKeys).toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledWith('hhr-runtime-cache');
    expect(deleteCache).toHaveBeenCalledWith('workbox-precache-v1');
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
    expect(localStorage.getItem('firebase:authUser:test:[DEFAULT]')).toBeNull();
    expect(localStorage.getItem('firebase:redirectUser:test:[DEFAULT]')).toBeNull();
    expect(localStorage.getItem('hhr_auth_bootstrap_pending_v1')).toBeNull();
    expect(localStorage.getItem('unrelated_local_key')).toBeNull();
    expect(sessionStorage.getItem('firebase:authUser:test:[DEFAULT]')).toBeNull();
    expect(sessionStorage.getItem('hhr_google_login_attempt_pending')).toBeNull();
    expect(sessionStorage.getItem('hhr_logged_this_session')).toBeNull();
    expect(sessionStorage.getItem('unrelated_session_key')).toBeNull();
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
    if (originalCaches) {
      Object.defineProperty(window, 'caches', originalCaches);
    } else {
      // @ts-expect-error - cleanup test-only property
      delete window.caches;
    }
  });

  it('falls back to known app IndexedDB databases when database enumeration is unavailable during full local reset', async () => {
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

    await idbService.resetLocalAppStorage();

    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('HangaRoaDB');
    expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    expect(window.location.reload).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDelete;
  });

  it('waits for IndexedDB deletion before reloading during full local reset', async () => {
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

    const resetPromise = idbService.resetLocalAppStorage();
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

  it('clears browser storage even if IndexedDB deletion remains pending during full local reset', async () => {
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
    localStorage.setItem('unrelated_local_key', 'remove-me');
    sessionStorage.setItem('unrelated_session_key', 'remove-me');

    const resetPromise = idbService.resetLocalAppStorage();
    await vi.waitFor(() => {
      expect(window.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    });

    expect(localStorage.getItem('unrelated_local_key')).toBeNull();
    expect(sessionStorage.getItem('unrelated_session_key')).toBeNull();
    expect(window.location.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);
    await resetPromise;

    expect(window.location.reload).toHaveBeenCalled();

    vi.useRealTimers();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.indexedDB.databases = originalDatabases;
    window.indexedDB.deleteDatabase = originalDelete;
  });
});
