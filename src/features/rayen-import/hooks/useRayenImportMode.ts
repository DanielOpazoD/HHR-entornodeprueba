import { useSyncExternalStore } from 'react';
import {
  DEFAULT_RAYEN_IMPORT_MODE,
  getRayenImportMode,
  setRayenImportMode,
  subscribeRayenImportMode,
  type RayenImportMode,
} from '../settings/rayenImportSettings';

export interface UseRayenImportModeResult {
  mode: RayenImportMode;
  setMode: (mode: RayenImportMode) => void;
}

/** Reactive access to the Rayen import mode setting. */
export const useRayenImportMode = (): UseRayenImportModeResult => {
  const mode = useSyncExternalStore(
    subscribeRayenImportMode,
    getRayenImportMode,
    () => DEFAULT_RAYEN_IMPORT_MODE
  );
  return { mode, setMode: setRayenImportMode };
};
