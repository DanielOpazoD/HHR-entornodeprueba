/* eslint-disable react/no-unknown-property */
import React, { useEffect, useRef, useState } from 'react';
import { Html, Text, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import type { BedDefinition, PatientData } from '@/types';
import type {
  SavedBedTransform,
  SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';

interface HospitalFloorMapBedMeshProps {
  bed: BedDefinition;
  patient?: PatientData;
  isEditMode: boolean;
  transform: SavedBedTransform;
  config: SavedLayout['config'];
  onTransformChange: (id: string, transform: SavedBedTransform) => void;
  onClick?: () => void;
}

export const HospitalFloorMapBedMesh: React.FC<HospitalFloorMapBedMeshProps> = ({
  bed,
  patient,
  isEditMode,
  transform,
  config,
  onTransformChange,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const [currentTransform, setCurrentTransform] = useState(transform);

  useEffect(() => {
    setCurrentTransform(transform);
  }, [transform]);

  const isOccupied = Boolean(patient?.patientName);
  const isBlocked = Boolean(patient?.isBlocked);

  const occupiedColor = config.colorOccupied || '#10b981';
  const freeColor = config.colorFree || '#94a3b8';
  const blockedColor = '#ef4444';

  let baseColor = freeColor;
  if (isBlocked) {
    baseColor = blockedColor;
  } else if (isOccupied) {
    baseColor = occupiedColor;
  }

  const materialProps = {
    transparent: !isOccupied && !isBlocked,
    opacity: !isOccupied && !isBlocked ? 0.3 : 1,
    roughness: 0.3,
    metalness: 0.1,
  };

  const color =
    hovered && !isEditMode ? new THREE.Color(baseColor).clone().offsetHSL(0, 0, 0.1) : baseColor;

  const width = config.bedWidth;
  const length = config.bedLength;

  const position: [number, number, number] = [currentTransform.x, 0, currentTransform.z];
  const rotation: [number, number, number] = [0, currentTransform.rotation, 0];

  const content = (
    <group
      ref={groupRef}
      position={isEditMode ? undefined : position}
      rotation={isEditMode ? undefined : rotation}
    >
      <mesh
        onClick={event => {
          if (isEditMode) {
            return;
          }
          event.stopPropagation();
          onClick?.();
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, 0.5, length]} />
        <meshStandardMaterial color={color} {...materialProps} />
      </mesh>

      <mesh position={[width / 2 - 0.1, -0.4, length / 2 - 0.1]} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#94a3b8" {...materialProps} />
      </mesh>
      <mesh position={[-width / 2 + 0.1, -0.4, length / 2 - 0.1]} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#94a3b8" {...materialProps} />
      </mesh>
      <mesh position={[width / 2 - 0.1, -0.4, -length / 2 + 0.1]} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#94a3b8" {...materialProps} />
      </mesh>
      <mesh position={[-width / 2 + 0.1, -0.4, -length / 2 + 0.1]} castShadow>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#94a3b8" {...materialProps} />
      </mesh>

      <mesh position={[0, 0.3, -length / 2 + 0.3]} castShadow>
        <boxGeometry args={[width * 0.8, 0.15, 0.4]} />
        <meshStandardMaterial color="white" />
      </mesh>

      <Text
        position={[0, 0.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        fontWeight={800}
        color={!isOccupied && !isBlocked ? '#cbd5e1' : 'white'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={!isOccupied && !isBlocked ? 0 : 0.04}
        outlineColor="#0f172a"
        fillOpacity={!isOccupied && !isBlocked ? 0.4 : 1}
      >
        {bed.name}
      </Text>

      {hovered && !isEditMode && (
        <Html position={[0, 1.5, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
          <div className="bg-white/90 backdrop-blur-sm p-2 rounded-lg shadow-xl border border-slate-200 min-w-[120px] text-center z-50">
            <p className="text-[10px] uppercase font-bold text-slate-400">{bed.name}</p>
            {isOccupied ? (
              <>
                <p className="font-bold text-slate-800 text-xs truncate max-w-[150px]">
                  {patient?.patientName}
                </p>
                <p className="text-[10px] text-slate-500">
                  {patient?.pathology || 'Sin diagnóstico'}
                </p>
              </>
            ) : isBlocked ? (
              <p className="font-bold text-red-600 text-xs uppercase">BLOQUEADA</p>
            ) : (
              <p className="font-bold text-slate-400 text-xs">DISPONIBLE</p>
            )}
          </div>
        </Html>
      )}
    </group>
  );

  if (!isEditMode) {
    return content;
  }

  return (
    <TransformControls
      showY={false}
      position={position}
      rotation={rotation}
      onMouseUp={() => {
        if (!groupRef.current) {
          return;
        }

        const nextTransform = {
          x: groupRef.current.position.x,
          z: groupRef.current.position.z,
          rotation: groupRef.current.rotation.y,
        };

        setCurrentTransform(nextTransform);
        onTransformChange(bed.id, nextTransform);
      }}
    >
      {content}
    </TransformControls>
  );
};
