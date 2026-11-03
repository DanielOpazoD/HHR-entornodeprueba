import { useEffect, useRef, useState } from 'react';
import type { DicomMeasurement } from '@/services/radiology/dicomMeasurementStore';
import type { DicomMode, DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';

export interface DicomMeasurementRequest {
  id: string;
  nonce: number;
}

/**
 * Takes the viewer to a measurement: its series first, then Original or MPR, then its slice.
 * MPR waits until the whole series is verified, as the MPR button does.
 */
export const useDicomMeasurementFocus = ({
  runtime,
  seriesUid,
  mode,
  ready,
  complete,
  request,
  changeMode,
  openSeries,
}: {
  runtime: DicomRuntime | null;
  seriesUid: string;
  mode: DicomMode;
  ready: boolean;
  complete: boolean;
  request?: DicomMeasurementRequest | null;
  changeMode: (mode: DicomMode) => void;
  openSeries?: (seriesUid: string, request: DicomMeasurementRequest) => void;
}) => {
  // A ref, not state: each step below only moves the viewer, it never re-renders by itself.
  const pending = useRef<string | null>(request?.id ?? null);
  const [chosen, setChosen] = useState(0);
  useEffect(() => {
    if (request) pending.current = request.id;
  }, [request]);
  useEffect(() => {
    const id = pending.current;
    if (!id || !runtime || !ready) return;
    const item = runtime.measurements.get(id);
    if (!item) {
      pending.current = null;
      return;
    }
    if (item.seriesUid !== seriesUid) {
      pending.current = null;
      openSeries?.(item.seriesUid, { id: item.id, nonce: Date.now() });
      return;
    }
    const target: DicomMode = item.view === 'original' ? 'original' : 'mpr';
    if (target === 'mpr' && !complete) return;
    if (mode !== target) {
      changeMode(target);
      return;
    }
    pending.current = null;
    runtime.focusMeasurement(item.id);
  }, [request, chosen, runtime, ready, complete, mode, seriesUid, changeMode, openSeries]);
  return (item: DicomMeasurement) => {
    pending.current = item.id;
    setChosen(value => value + 1);
  };
};
