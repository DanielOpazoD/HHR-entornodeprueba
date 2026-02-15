import { NURSES_STORAGE_KEY, STORAGE_KEY } from './localStorageCore';

export const clearAllData = (): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(NURSES_STORAGE_KEY);
};

export const isLocalStorageAvailable = (): boolean => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const testKey = '__test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};
