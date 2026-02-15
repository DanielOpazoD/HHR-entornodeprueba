/* eslint-disable react/no-unknown-property */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { BedDefinition, PatientData } from '@/types';
import {
  createHospitalFloorMapRuntime,
  executeResetLayout,
  persistSavedLayout,
  resolveSavedLayoutState,
  type SavedBedTransform,
  type SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';
import {
  createDefaultSavedLayout,
  HOSPITAL_FLOOR_STORAGE_KEY,
  resolveHospitalFloorBedItems,
  resolveZoomValueFromDistance,
  ZOOM_IN_SCALE_FACTOR,
  ZOOM_OUT_SCALE_FACTOR,
} from '@/features/census/controllers/hospitalFloorMapViewController';
import { HospitalFloorMapBedMesh } from '@/features/census/components/3d/HospitalFloorMapBedMesh';
import { HospitalFloorMapZoomControls } from '@/features/census/components/3d/HospitalFloorMapZoomControls';
import { HospitalFloorMapToolbar } from '@/features/census/components/3d/HospitalFloorMapToolbar';
import { HospitalFloorMapConfigPanel } from '@/features/census/components/3d/HospitalFloorMapConfigPanel';
import { HospitalFloorMapLegend } from '@/features/census/components/3d/HospitalFloorMapLegend';

interface HospitalFloorMapProps {
  beds: BedDefinition[];
  patients: Record<string, PatientData>;
  onBedClick?: (bedId: string) => void;
}

const applyCameraScale = (
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>,
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

const updateSavedLayoutConfig = (
  previousLayout: SavedLayout,
  nextConfigPatch: Partial<SavedLayout['config']>
): SavedLayout => ({
  ...previousLayout,
  config: {
    ...previousLayout.config,
    ...nextConfigPatch,
  },
});

export const HospitalFloorMap = ({ beds, patients, onBedClick }: HospitalFloorMapProps) => {
  const runtime = useMemo(() => createHospitalFloorMapRuntime(), []);
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
    setLayout(previousLayout => ({
      ...previousLayout,
      beds: {
        ...previousLayout.beds,
        [id]: transform,
      },
    }));
  }, []);

  const resetLayout = useCallback(() => {
    executeResetLayout({
      runtime,
      storageKey: HOSPITAL_FLOOR_STORAGE_KEY,
      confirmMessage: '¿Restablecer posición de camas a la distribución original?',
    });
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
    setLayout(previousLayout =>
      updateSavedLayoutConfig(previousLayout, { bedWidth: nextBedWidth })
    );
  }, []);

  const setBedLength = useCallback((nextBedLength: number) => {
    setLayout(previousLayout =>
      updateSavedLayoutConfig(previousLayout, { bedLength: nextBedLength })
    );
  }, []);

  const setColorFree = useCallback((nextColorFree: string) => {
    setLayout(previousLayout =>
      updateSavedLayoutConfig(previousLayout, { colorFree: nextColorFree })
    );
  }, []);

  const setColorOccupied = useCallback((nextColorOccupied: string) => {
    setLayout(previousLayout =>
      updateSavedLayoutConfig(previousLayout, { colorOccupied: nextColorOccupied })
    );
  }, []);

  return (
    <div className="w-full h-[600px] bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-inner relative group">
      <Canvas shadows camera={{ position: [0, 21.8, 0], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[5, 15, 5]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <Environment preset="city" />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={!isEditMode}
          maxPolarAngle={Math.PI / 2}
          minPolarAngle={0}
          onChange={handleZoomUpdateFromControls}
        />

        <group position={[0, -0.5, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#f1f5f9" />
          </mesh>
          <gridHelper args={[50, 50, '#cbd5e1', '#e2e8f0']} />
        </group>

        <ContactShadows position={[0, -0.49, 0]} opacity={0.4} scale={20} blur={2} far={4} />

        {bedItems.map(({ bed, transform }) => (
          <HospitalFloorMapBedMesh
            key={bed.id}
            bed={bed}
            patient={patients[bed.id]}
            isEditMode={isEditMode}
            transform={transform}
            config={layout.config}
            onTransformChange={handleTransformChange}
            onClick={() => onBedClick?.(bed.id)}
          />
        ))}
      </Canvas>

      <HospitalFloorMapZoomControls
        zoomValue={zoomValue}
        isEditMode={isEditMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />

      <HospitalFloorMapToolbar
        isEditMode={isEditMode}
        showConfig={showConfig}
        onToggleEditMode={() => setIsEditMode(previousValue => !previousValue)}
        onToggleConfig={() => setShowConfig(previousValue => !previousValue)}
      />

      {showConfig && (
        <HospitalFloorMapConfigPanel
          config={layout.config}
          onBedWidthChange={setBedWidth}
          onBedLengthChange={setBedLength}
          onColorFreeChange={setColorFree}
          onColorOccupiedChange={setColorOccupied}
          onReset={resetLayout}
          onSave={saveLayout}
        />
      )}

      <HospitalFloorMapLegend isEditMode={isEditMode} showConfig={showConfig} />
    </div>
  );
};

export default HospitalFloorMap;
