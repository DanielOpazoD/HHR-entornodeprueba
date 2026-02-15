/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei';
import type { BedDefinition, PatientData } from '@/types';
import { HospitalFloorMapBedMesh } from '@/features/census/components/3d/HospitalFloorMapBedMesh';
import { HospitalFloorMapZoomControls } from '@/features/census/components/3d/HospitalFloorMapZoomControls';
import { HospitalFloorMapToolbar } from '@/features/census/components/3d/HospitalFloorMapToolbar';
import { HospitalFloorMapConfigPanel } from '@/features/census/components/3d/HospitalFloorMapConfigPanel';
import { HospitalFloorMapLegend } from '@/features/census/components/3d/HospitalFloorMapLegend';
import { useHospitalFloorMapModel } from '@/features/census/components/3d/useHospitalFloorMapModel';

interface HospitalFloorMapProps {
  beds: BedDefinition[];
  patients: Record<string, PatientData>;
  onBedClick?: (bedId: string) => void;
}

export const HospitalFloorMap = ({ beds, patients, onBedClick }: HospitalFloorMapProps) => {
  const {
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
  } = useHospitalFloorMapModel({ beds });

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
        onToggleEditMode={toggleEditMode}
        onToggleConfig={toggleConfig}
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
