import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

const canUseWindow = (): boolean => typeof window !== 'undefined';

const clearIndexedDatabases = async (): Promise<void> => {
  if (!canUseWindow()) return;

  try {
    const dbs = await window.indexedDB.databases();
    for (const dbInfo of dbs) {
      if (dbInfo.name) {
        window.indexedDB.deleteDatabase(dbInfo.name);
      }
    }
  } catch (error) {
    console.error('Failed to clear IndexedDB databases:', error);
  }
};

const clearBrowserStorage = (): void => {
  if (!canUseWindow()) return;

  localStorage.clear();
  sessionStorage.clear();
};

const unregisterServiceWorkers = async (): Promise<void> => {
  if (!canUseWindow() || !('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  } catch (error) {
    console.error('Failed to unregister service workers:', error);
  }
};

export const resetLocalDatabase = async (): Promise<void> => {
  await clearIndexedDatabases();
  clearBrowserStorage();
  defaultBrowserWindowRuntime.reload();
};

export const performClientHardReset = async (): Promise<void> => {
  await unregisterServiceWorkers();
  await clearIndexedDatabases();
  clearBrowserStorage();
  defaultBrowserWindowRuntime.reload();
};
