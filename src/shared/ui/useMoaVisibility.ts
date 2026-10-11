import { useSyncExternalStore } from 'react';

const preferenceKey = 'hhr_moa_visible_v1';
const listeners = new Set<() => void>();
let sessionPreference: boolean | undefined;

const getVisible = (): boolean => {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    return localStorage.getItem(preferenceKey) !== 'false';
  } catch {
    return true;
  }
};

const notify = () => listeners.forEach(listener => listener());
const onStorage = (event: StorageEvent) => {
  if (event.key === preferenceKey || event.key === null) {
    sessionPreference = undefined;
    notify();
  }
};

const subscribe = (listener: () => void) => {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
};

export const setMoaVisible = (visible: boolean) => {
  sessionPreference = visible;
  try {
    localStorage.setItem(preferenceKey, String(visible));
    sessionPreference = undefined;
  } catch {
    // Keep the preference for this session when storage is unavailable.
  }
  notify();
};

export const useMoaVisibility = () => useSyncExternalStore(subscribe, getVisible, () => false);

export const hideMoaAndRestoreFocus = () => {
  setMoaVisible(false);
  document.querySelector<HTMLButtonElement>('[data-moa-toggle]')?.focus();
};
