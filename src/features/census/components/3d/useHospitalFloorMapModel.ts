import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { BedDefinition } from '@/types';
import {
  createHospitalFloorMapRuntime,
  executeResetLayout,
  persistSavedLayout,
  resolveSavedLayoutState,
  type HospitalFloorMapRuntime,
  type SavedBedTransform,
  type SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';
import {
  applyHospitalFloorBedTransform,
  patchHospitalFloorLayoutConfig,
} from '@/features/census/controllers/hospitalFloorMapStateController';
import {
  createDefaultSavedLayout,
  HOSPITAL_FLOOR_STORAGE_KEY,
  resolveHospitalFloorBedItems,
  resolveZoomValueFromDistance,
  ZOOM_IN_SCALE_FACTOR,
  ZOOM_OUT_SCALE_FACTOR,
} from '@/features/census/controllers/hospitalFloorMapViewController';

interface UseHospitalFloorMapModelParams {
  beds: BedDefinition[];
  runtime?: HospitalFloorMapRuntime;
}

interface UseHospitalFloorMapModelResult {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  isEditMode: boolean;
  showConfig: boolean;
  zoomValue: number;
  layout: SavedLayout;
  bedItems: ReturnType<typeof resolveHospitalFloorBedItems>;
  toggleEditMode: () => void;
  toggleConfig: () => void;
  saveLayout: () => void;
  resetLayout: () => void;
  handleTransformChange: (id: string, transform: SavedBedTransform) => void;
  handleZoomUpdateFromControls: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  setBedWidth: (nextBedWidth: number) => void;
  setBedLength: (nextBedLength: number) => void;
  setColorFree: (nextColorFree: string) => void;
  setColorOccupied: (nextColorOccupied: string) => void;
}

const applyCameraScale = (
  controlsRef: MutableRefObject<OrbitControlsImpl | null>,
  scaleFactor: number
): number | null => {
  const controls = controlsRef.current;
  if (!controls) {
    return null;
  }

  const camera = controls.object;
  camera.position.multiplyScalar(scaleFactor);
  controls.update();

  return controls.getDistance();
};

const isValidDimension = (value: number): boolean => Number.isFinite(value) && value > 0;

export const useHospitalFloorMapModel = ({
  beds,
  runtime: runtimeOverride,
}: UseHospitalFloorMapModelParams): UseHospitalFloorMapModelResult => {
  const runtime = useMemo(
    () => runtimeOverride || createHospitalFloorMapRuntime(),
    [runtimeOverride]
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [zoomValue, setZoomValue] = useState(55);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const [layout, setLayout] = useState<SavedLayout>(() =>
    resolveSavedLayoutState(runtime.getItem(HOSPITAL_FLOOR_STORAGE_KEY), createDefaultSavedLayout())
  );

  const saveLayout = useCallback(() => {
    persistSavedLayout(runtime, HOSPITAL_FLOOR_STORAGE_KEY, layout);
    setIsEditMode(false);
  }, [layout, runtime]);

  const handleTransformChange = useCallback((id: string, transform: SavedBedTransform) => {
    setLayout(previousLayout => applyHospitalFloorBedTransform(previousLayout, id, transform));
  }, []);

  const resetLayout = useCallback(() => {
    const hasReset = executeResetLayout({
      runtime,
      storageKey: HOSPITAL_FLOOR_STORAGE_KEY,
      confirmMessage: '¿Restablecer posición de camas a la distribución original?',
    });
    if (hasReset) {
      setLayout(createDefaultSavedLayout());
    }
  }, [runtime]);

  const bedItems = useMemo(
    () =>
      resolveHospitalFloorBedItems({
        beds,
        savedBeds: layout.beds,
      }),
    [beds, layout.beds]
  );

  const handleZoomUpdateFromControls = useCallback(() => {
    if (!controlsRef.current) {
      return;
    }

    const distance = controlsRef.current.getDistance();
    setZoomValue(previousValue => {
      const nextValue = resolveZoomValueFromDistance(distance);
      return previousValue === nextValue ? previousValue : nextValue;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    const nextDistance = applyCameraScale(controlsRef, ZOOM_IN_SCALE_FACTOR);
    if (nextDistance === null) {
      return;
    }

    setZoomValue(resolveZoomValueFromDistance(nextDistance));
  }, []);

  const handleZoomOut = useCallback(() => {
    const nextDistance = applyCameraScale(controlsRef, ZOOM_OUT_SCALE_FACTOR);
    if (nextDistance === null) {
      return;
    }

    setZoomValue(resolveZoomValueFromDistance(nextDistance));
  }, []);

  const setBedWidth = useCallback((nextBedWidth: number) => {
    if (!isValidDimension(nextBedWidth)) {
      return;
    }

    setLayout(previousLayout =>
      patchHospitalFloorLayoutConfig(previousLayout, { bedWidth: nextBedWidth })
    );
  }, []);

  const setBedLength = useCallback((nextBedLength: number) => {
    if (!isValidDimension(nextBedLength)) {
      return;
    }

    setLayout(previousLayout =>
      patchHospitalFloorLayoutConfig(previousLayout, { bedLength: nextBedLength })
    );
  }, []);

  const setColorFree = useCallback((nextColorFree: string) => {
    setLayout(previousLayout =>
      patchHospitalFloorLayoutConfig(previousLayout, { colorFree: nextColorFree })
    );
  }, []);

  const setColorOccupied = useCallback((nextColorOccupied: string) => {
    setLayout(previousLayout =>
      patchHospitalFloorLayoutConfig(previousLayout, { colorOccupied: nextColorOccupied })
    );
  }, []);

  const toggleEditMode = useCallback(() => {
    setIsEditMode(previousValue => !previousValue);
  }, []);

  const toggleConfig = useCallback(() => {
    setShowConfig(previousValue => !previousValue);
  }, []);

  return {
    controlsRef,
    isEditMode,
    showConfig,
    zoomValue,
    layout,
    bedItems,
    toggleEditMode,
    toggleConfig,
    saveLayout,
    resetLayout,
    handleTransformChange,
    handleZoomUpdateFromControls,
    handleZoomIn,
    handleZoomOut,
    setBedWidth,
    setBedLength,
    setColorFree,
    setColorOccupied,
  };
};
