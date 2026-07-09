/**
 * Rayen import mode setting.
 *
 * - `preview` (default, SIEMPRE seguro): el usuario revisa el diff y confirma.
 * - `auto`    (EXPERIMENTAL): aplica el diff sin preview (los conflictos igual se retienen).
 *
 * Persisted in localStorage (device-local), mirroring the app's `uiSettingsService`
 * and `featureFlags` conventions. The default must stay `preview`.
 */

export type RayenImportMode = 'preview' | 'auto';

export const RAYEN_IMPORT_MODE_KEY = 'hhr_rayen_import_mode';
export const DEFAULT_RAYEN_IMPORT_MODE: RayenImportMode = 'preview';

const listeners = new Set<() => void>();

export const getRayenImportMode = (): RayenImportMode => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_RAYEN_IMPORT_MODE;
    return localStorage.getItem(RAYEN_IMPORT_MODE_KEY) === 'auto'
      ? 'auto'
      : DEFAULT_RAYEN_IMPORT_MODE;
  } catch {
    return DEFAULT_RAYEN_IMPORT_MODE;
  }
};

export const setRayenImportMode = (mode: RayenImportMode): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RAYEN_IMPORT_MODE_KEY, mode);
    }
  } catch {
    // localStorage unavailable — keep the in-memory notification path working anyway.
  }
  listeners.forEach(listener => listener());
};

/** Subscribe to mode changes. Returns an unsubscribe function. */
export const subscribeRayenImportMode = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
