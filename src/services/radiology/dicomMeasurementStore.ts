import type { DicomMeasurementKind, DicomMeasurementValue } from './dicomMeasurementText';

export type DicomMeasurementView = 'original' | 'axial' | 'coronal' | 'sagittal';

export interface DicomMeasurement {
  /** Cornerstone annotation UID. */
  id: string;
  kind: DicomMeasurementKind;
  seriesUid: string;
  seriesNumber: number;
  modality: string;
  view: DicomMeasurementView;
  oblique?: boolean;
  /** Zero-based slice: the instance position in Original, the plane slice in MPR. */
  slice: number;
  instanceUid?: string;
  value?: DicomMeasurementValue;
  /** World points (mm, LPS) of the handles, for the volume calculators. */
  points: number[][];
  /** Detached copy of the annotation so it can be drawn again after a series or mode change. */
  annotation: unknown;
}

/**
 * Measurements of one open viewer. Memory only: nothing goes to storage, MMRAD or telemetry,
 * and closing the viewer drops the store with it.
 */
export const createDicomMeasurementStore = () => {
  const items = new Map<string, DicomMeasurement>();
  const listeners = new Set<(items: readonly DicomMeasurement[]) => void>();
  let snapshot: readonly DicomMeasurement[] = [];
  const emit = () => {
    snapshot = [...items.values()];
    listeners.forEach(listener => listener(snapshot));
  };
  const removeWhere = (match: (item: DicomMeasurement) => boolean) => {
    let changed = false;
    for (const item of [...items.values()])
      if (match(item)) changed = items.delete(item.id) || changed;
    if (changed) emit();
  };
  return {
    list: () => snapshot,
    get: (id: string) => items.get(id),
    upsert: (item: DicomMeasurement) => {
      items.set(item.id, item);
      emit();
    },
    remove: (id: string) => removeWhere(item => item.id === id),
    removeWhere,
    /** Removes the newest measurement of a context, e.g. this series in Original. */
    undo: (match: (item: DicomMeasurement) => boolean) => {
      const last = [...items.values()].reverse().find(match);
      if (last) removeWhere(item => item.id === last.id);
    },
    clear: () => removeWhere(() => true),
    subscribe: (listener: (items: readonly DicomMeasurement[]) => void) => {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
export type DicomMeasurementStore = ReturnType<typeof createDicomMeasurementStore>;
