import { useSyncExternalStore } from 'react';

/**
 * View choice of this computer for the census table (2026-11-04, the owner's request): nursing
 * uses the Eloísa chart alerts to report scales, so the census can read them in place of the
 * clinical columns. Hiding Braden and Downton is global, in the table configuration.
 */
export interface CensusViewPreferences {
  alertsView: boolean;
}

const preferenceKey = 'hhr_census_view_v1';
const DEFAULTS: CensusViewPreferences = { alertsView: false };
const listeners = new Set<() => void>();
let snapshot: CensusViewPreferences | undefined;

const read = (): CensusViewPreferences => {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
    return { alertsView: stored?.alertsView === true };
  } catch {
    return DEFAULTS;
  }
};

const getSnapshot = (): CensusViewPreferences => (snapshot ??= read());
const notify = () => listeners.forEach(listener => listener());
const onStorage = (event: StorageEvent) => {
  if (event.key !== preferenceKey && event.key !== null) return;
  snapshot = undefined;
  notify();
};

const subscribe = (listener: () => void) => {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
};

export const setCensusViewPreference = (change: Partial<CensusViewPreferences>): void => {
  snapshot = { ...getSnapshot(), ...change };
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(snapshot));
  } catch {
    // Keep the choice for this session when storage is unavailable.
  }
  notify();
};

export const useCensusViewPreferences = (): CensusViewPreferences =>
  useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
