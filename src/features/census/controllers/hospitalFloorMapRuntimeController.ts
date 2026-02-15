import {
  createCensusDialogRuntime,
  createCensusStorageRuntime,
} from '@/features/census/controllers/censusBrowserRuntimeAdapter';

export interface SavedBedTransform {
  x: number;
  z: number;
  rotation: number;
}

export interface SavedLayout {
  beds: Record<string, SavedBedTransform>;
  config: {
    bedWidth: number;
    bedLength: number;
    colorOccupied: string;
    colorFree: string;
  };
}

export interface HospitalFloorMapRuntime {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  confirm: (message: string) => boolean;
}

const storageRuntime = createCensusStorageRuntime();
const dialogRuntime = createCensusDialogRuntime();

export const createHospitalFloorMapRuntime = (): HospitalFloorMapRuntime => ({
  ...storageRuntime,
  confirm: message => dialogRuntime.confirm(message),
});

export const resolveSavedLayoutState = (
  rawValue: string | null,
  defaultState: SavedLayout
): SavedLayout => {
  if (!rawValue) {
    return defaultState;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SavedLayout>;
    return {
      beds: parsed.beds || {},
      config: { ...defaultState.config, ...(parsed.config || {}) },
    };
  } catch {
    return defaultState;
  }
};

export const persistSavedLayout = (
  runtime: HospitalFloorMapRuntime,
  storageKey: string,
  layout: SavedLayout
): void => {
  runtime.setItem(storageKey, JSON.stringify(layout));
};

interface ExecuteResetLayoutParams {
  runtime: HospitalFloorMapRuntime;
  storageKey: string;
  confirmMessage: string;
}

export const executeResetLayout = ({
  runtime,
  storageKey,
  confirmMessage,
}: ExecuteResetLayoutParams): boolean => {
  const confirmed = runtime.confirm(confirmMessage);
  if (!confirmed) {
    return false;
  }

  runtime.removeItem(storageKey);
  return true;
};
