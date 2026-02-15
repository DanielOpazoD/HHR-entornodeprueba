/* eslint-disable react/no-unknown-property */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, Text, Environment, ContactShadows, TransformControls } from '@react-three/drei';
import { BedDefinition, PatientData } from '@/types';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import clsx from 'clsx';
import { Settings, Save, RotateCcw, Move, MousePointer2, ZoomIn, ZoomOut, Search } from 'lucide-react';

interface HospitalFloorMapProps {
    beds: BedDefinition[];
    patients: Record<string, PatientData>;
    onBedClick?: (bedId: string) => void;
}

// Persisted Layout Data Type
interface SavedBedTransform {
    x: number;
    z: number;
    rotation: number;
}

interface SavedLayout {
    beds: Record<string, SavedBedTransform>;
    config: {
        bedWidth: number;
        bedLength: number;
        colorOccupied: string;
        colorFree: string;
    };
}

// Bumped version to v2 to force new color defaults
const STORAGE_KEY = 'hhr_3d_layout_v2';

// Strict Aligned Layout
// Inner Columns: +/- 2.5
// Outer Columns: +/- 4.2
// Bed Width approx 1.5, gap 0.2 -> Spacing ~1.7
const DEFAULT_LAYOUT: Record<string, SavedBedTransform> = {
    // Top Row (UTI)
    // R1 aligns with H4C2 (-2.5)
    'R1': { x: -2.5, z: -6.0, rotation: 0 },
    // R2 spaced 1.7 units right of R1
    'R2': { x: -0.8, z: -6.0, rotation: 0 },
    // R3 aligns with H1C1 (2.5)
    'R3': { x: 2.5, z: -6.0, rotation: 0 },
    // R4 aligns with H1C2 (4.2)
    'R4': { x: 4.2, z: -6.0, rotation: 0 },

    // Middle Right (Neonatology)
    // NEO1 aligns with H1C1 (2.5)
    'NEO1': { x: 2.5, z: -3.5, rotation: 0 },
    // NEO2 aligns with H1C2 (4.2)
    'NEO2': { x: 4.2, z: -3.5, rotation: 0 },

    // Right Block (Medicine A: H1-H3)
    'H1C1': { x: 2.5, z: -0.5, rotation: 0 },
    'H1C2': { x: 4.2, z: -0.5, rotation: 0 },
    'H2C1': { x: 2.5, z: 2.2, rotation: 0 },
    'H2C2': { x: 4.2, z: 2.2, rotation: 0 },
    'H3C1': { x: 2.5, z: 4.9, rotation: 0 },
    'H3C2': { x: 4.2, z: 4.9, rotation: 0 },

    // Left Block (Medicine B: H4-H6)
    'H4C1': { x: -4.2, z: -0.5, rotation: 0 },
    'H4C2': { x: -2.5, z: -0.5, rotation: 0 },
    'H5C1': { x: -4.2, z: 2.2, rotation: 0 },
    'H5C2': { x: -2.5, z: 2.2, rotation: 0 },
    'H6C1': { x: -4.2, z: 4.9, rotation: 0 },
    'H6C2': { x: -2.5, z: 4.9, rotation: 0 },
};

// Internal Bed 3D Component
const BedMesh = ({
    bed,
    patient,
    isEditMode,
    transform,
    config,
    onTransformChange,
    onClick
}: {
    bed: BedDefinition;
    patient?: PatientData;
    isEditMode: boolean;
    transform: SavedBedTransform;
    config: SavedLayout['config'];
    onTransformChange: (id: string, t: SavedBedTransform) => void;
    onClick?: () => void;
}) => {
    const [hovered, setHovered] = useState(false);
    const groupRef = useRef<THREE.Group>(null);
    const [currentTransform, setCurrentTransform] = useState(transform);

    // Sync internal state if external transform changes (e.g. from layout reset)
    useEffect(() => {
        setCurrentTransform(transform);
    }, [transform]);

    // Status Logic
    const isOccupied = !!patient?.patientName;
    const isBlocked = patient?.isBlocked;

    // Color Logic
    const occupiedColor = config.colorOccupied || '#10b981'; // Green
    const freeColor = config.colorFree || '#94a3b8'; // Gray
    const blockedColor = '#ef4444'; // Red for blocked (Hardcoded standard)

    let baseColor = freeColor;
    if (isBlocked) baseColor = blockedColor;
    else if (isOccupied) baseColor = occupiedColor;

    const materialProps = {
        transparent: !isOccupied && !isBlocked,
        opacity: (!isOccupied && !isBlocked) ? 0.3 : 1,
        roughness: 0.3,
        metalness: 0.1
    };

    const color = hovered && !isEditMode ? new THREE.Color(baseColor).clone().offsetHSL(0, 0, 0.1) : baseColor;

    // Bed Dimensions from config
    const width = config.bedWidth;
    const length = config.bedLength;

    // Apply manual transform or layout
    const position: [number, number, number] = [currentTransform.x, 0, currentTransform.z];
    const rotation: [number, number, number] = [0, currentTransform.rotation, 0];

    // Only render hitbox for TransformControls to reduce visual noise when editing
    const content = (
        <group ref={groupRef} position={isEditMode ? undefined : position} rotation={isEditMode ? undefined : rotation}>
            {/* Hitbox/Base */}
            <mesh
                onClick={(e) => {
                    if (isEditMode) return;
                    e.stopPropagation();
                    onClick?.();
                }}
                onPointerOver={() => setHovered(true)}
                onPointerOut={() => setHovered(false)}
                castShadow receiveShadow
            >
                <boxGeometry args={[width, 0.5, length]} />
                <meshStandardMaterial color={color} {...materialProps} />
            </mesh>

            {/* Bed Legs */}
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

            {/* Pillow */}
            <mesh position={[0, 0.3, -length / 2 + 0.3]} castShadow>
                <boxGeometry args={[width * 0.8, 0.15, 0.4]} />
                <meshStandardMaterial color="white" />
            </mesh>

            {/* Bed Number Label - Raised higher for visibility */}
            <Text
                position={[0, 0.5, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.5}
                fontWeight={800}
                color={(!isOccupied && !isBlocked) ? "#cbd5e1" : "white"}
                anchorX="center"
                anchorY="middle"
                outlineWidth={(!isOccupied && !isBlocked) ? 0 : 0.04}
                outlineColor="#0f172a"
                fillOpacity={(!isOccupied && !isBlocked) ? 0.4 : 1}
            >
                {bed.name}
            </Text>

            {/* Patient Info HTML Overlay */}
            {hovered && !isEditMode && (
                <Html position={[0, 1.5, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
                    <div className="bg-white/90 backdrop-blur-sm p-2 rounded-lg shadow-xl border border-slate-200 min-w-[120px] text-center z-50">
                        <p className="text-[10px] uppercase font-bold text-slate-400">{bed.name}</p>
                        {isOccupied ? (
                            <>
                                <p className="font-bold text-slate-800 text-xs truncate max-w-[150px]">
                                    {patient.patientName}
                                </p>
                                <p className="text-[10px] text-slate-500">{patient.pathology || "Sin diagnóstico"}</p>
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

    if (isEditMode) {
        return (
            <TransformControls
                showY={false}
                position={position}
                rotation={rotation}
                onMouseUp={() => {
                    if (groupRef.current) {
                        const newT = {
                            x: groupRef.current.position.x,
                            z: groupRef.current.position.z,
                            rotation: groupRef.current.rotation.y
                        };
                        setCurrentTransform(newT);
                        onTransformChange(bed.id, newT);
                    }
                }}
            >
                {content}
            </TransformControls>
        );
    }

    return content;
};

export const HospitalFloorMap = ({ beds, patients }: HospitalFloorMapProps) => {
    const [isEditMode, setIsEditMode] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [zoomValue, setZoomValue] = useState(55);
    const controlsRef = useRef<OrbitControlsImpl | null>(null);

    // Initial state from localStorage to avoid cascading renders in useEffect
    const [layout, setLayout] = useState<SavedLayout>(() => {
        const defaultState: SavedLayout = {
            beds: {},
            config: {
                bedWidth: 1.5,
                bedLength: 2.2,
                colorOccupied: '#10b981', // Green
                colorFree: '#94a3b8'     // Gray
            }
        };

        const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return {
                    beds: parsed.beds || {},
                    config: { ...defaultState.config, ...(parsed.config || {}) }
                };
            } catch (e) {
                console.error("Failed to load 3D layout", e);
            }
        }
        return defaultState;
    });

    // 2. Save to localStorage
    const saveLayout = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
        setIsEditMode(false);
    };

    // 3. Helper to update a bed's position
    const handleTransformChange = (id: string, t: SavedBedTransform) => {
        setLayout(prev => ({
            ...prev,
            beds: {
                ...prev.beds,
                [id]: t
            }
        }));
    };

    // 4. Reset Layout
    const resetLayout = () => {
        if (confirm('¿Restablecer posición de camas a la distribución original?')) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
        }
    };

    // 5. Generate Default Positions
    const bedItems = useMemo(() => {
        const cols = 4;
        const spacingX = 2.5;
        const spacingZ = 4;

        return beds.map((bed, index) => {
            if (layout.beds[bed.id]) {
                return { bed, transform: layout.beds[bed.id] };
            }
            if (DEFAULT_LAYOUT[bed.id]) {
                return { bed, transform: DEFAULT_LAYOUT[bed.id] };
            }
            const row = Math.floor(index / cols);
            const col = index % cols;
            const x = (col - (cols - 1) / 2) * spacingX;
            const z = (row - (Math.ceil(beds.length / cols) - 1) / 2) * spacingZ;
            return { bed, transform: { x, z, rotation: 0 } as SavedBedTransform };
        });
    }, [beds, layout.beds]);

    return (
        <div className="w-full h-[600px] bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-inner relative group">
            {/* Camera optimized for top-down angle view - Default distance 21.8 for ~55% zoom */}
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
                    onChange={() => {
                        if (controlsRef.current) {
                            const distance = controlsRef.current.getDistance();
                            // Normalize distance to percentage (approx 12 units is 100%)
                            const percentage = Math.round((12 / distance) * 100);
                            // Avoid setting state during render if values haven't changed meaningfully
                            setZoomValue(prev => {
                                const newValue = Math.max(10, Math.min(500, percentage));
                                return prev === newValue ? prev : newValue;
                            });
                        }
                    }}
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
                    <BedMesh
                        key={bed.id}
                        bed={bed}
                        patient={patients[bed.id]}
                        isEditMode={isEditMode}
                        transform={transform}
                        config={layout.config}
                        onTransformChange={handleTransformChange}
                        onClick={() => console.warn('Clicked bed', bed.id)}
                    />
                ))}
            </Canvas>

            {/* Zoom Controls (Floating Top Left) */}
            <div className="absolute top-4 left-4 flex flex-col gap-2">
                <div className="bg-white/90 backdrop-blur p-1 rounded-lg shadow-sm border border-slate-200 flex flex-col gap-1 pointer-events-auto overflow-hidden">
                    <button
                        onClick={() => {
                            if (controlsRef.current) {
                                const controls = controlsRef.current;
                                const camera = controls.object;
                                camera.position.multiplyScalar(0.9);
                                controls.update();
                            }
                        }}
                        className="p-1.5 hover:bg-slate-100 text-slate-500 rounded transition-colors"
                        title="Acercar"
                    >
                        <ZoomIn size={18} />
                    </button>
                    <div className="h-px bg-slate-100 mx-1" />
                    <div className="flex flex-col items-center justify-center py-1">
                        <Search size={10} className="text-slate-300 mb-0.5" />
                        <span className="text-[10px] font-bold text-slate-600 tabular-nums">
                            {zoomValue}%
                        </span>
                    </div>
                    <div className="h-px bg-slate-100 mx-1" />
                    <button
                        onClick={() => {
                            if (controlsRef.current) {
                                const controls = controlsRef.current;
                                const camera = controls.object;
                                camera.position.multiplyScalar(1.1);
                                controls.update();
                            }
                        }}
                        className="p-1.5 hover:bg-slate-100 text-slate-500 rounded transition-colors"
                        title="Alejar"
                    >
                        <ZoomOut size={18} />
                    </button>
                </div>

                {/* Mode Banner moves below zoom if active */}
                {isEditMode && (
                    <div className="bg-indigo-600/90 backdrop-blur text-white px-3 py-1.5 rounded-lg shadow-lg text-xs font-bold animate-pulse flex items-center gap-2 pointer-events-auto">
                        <MousePointer2 size={14} />
                        Libertad de Movimiento
                    </div>
                )}
            </div>

            {/* UI Controls Overlay (Right) */}
            <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
                <div className="bg-white/90 backdrop-blur p-1 rounded-lg shadow-sm border border-slate-200 flex gap-1 pointer-events-auto">
                    <button
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={clsx(
                            "p-2 rounded-md transition-all",
                            isEditMode ? "bg-indigo-100 text-indigo-700" : "hover:bg-slate-100 text-slate-500"
                        )}
                        title={isEditMode ? "Finalizar Edición" : "Editar Distribución"}
                    >
                        {isEditMode ? <Save size={18} /> : <Move size={18} />}
                    </button>
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        className={clsx(
                            "p-2 rounded-md transition-all",
                            showConfig ? "bg-slate-100 text-slate-800" : "hover:bg-slate-100 text-slate-500"
                        )}
                        title="Configuración Visual"
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </div>

            {showConfig && (
                <div className="absolute top-16 right-4 bg-white/95 backdrop-blur p-4 rounded-xl shadow-xl border border-slate-200 w-64 animate-scale-in z-10 pointer-events-auto">
                    <h3 className="text-xs font-bold uppercase text-slate-400 mb-3 tracking-wider">Apariencia</h3>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-700">Dimensión Camas</label>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <span className="text-[10px] text-slate-400 block mb-1">Ancho</span>
                                    <input
                                        type="number" step="0.1"
                                        value={layout.config.bedWidth}
                                        onChange={(e) => setLayout({ ...layout, config: { ...layout.config, bedWidth: parseFloat(e.target.value) } })}
                                        className="w-full px-2 py-1 bg-slate-50 border rounded text-xs"
                                    />
                                </div>
                                <div>
                                    <span className="text-[10px] text-slate-400 block mb-1">Largo</span>
                                    <input
                                        type="number" step="0.1"
                                        value={layout.config.bedLength}
                                        onChange={(e) => setLayout({ ...layout, config: { ...layout.config, bedLength: parseFloat(e.target.value) } })}
                                        className="w-full px-2 py-1 bg-slate-50 border rounded text-xs"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-700">Colores</label>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Disponible</span>
                                <input
                                    type="color"
                                    value={layout.config.colorFree}
                                    onChange={(e) => setLayout({ ...layout, config: { ...layout.config, colorFree: e.target.value } })}
                                    className="w-8 h-8 rounded cursor-pointer border-0"
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Ocupada</span>
                                <input
                                    type="color"
                                    value={layout.config.colorOccupied}
                                    onChange={(e) => setLayout({ ...layout, config: { ...layout.config, colorOccupied: e.target.value } })}
                                    className="w-8 h-8 rounded cursor-pointer border-0"
                                />
                            </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex justify-between">
                            <button
                                onClick={resetLayout}
                                className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                            >
                                <RotateCcw size={12} /> Reset
                            </button>
                            <button
                                onClick={saveLayout}
                                className="text-xs bg-slate-900 text-white px-3 py-1 rounded hover:bg-black transition-colors"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {!isEditMode && !showConfig && (
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none text-[10px] text-slate-400">
                    <div className="bg-white/50 backdrop-blur px-2 py-1 rounded border border-white/40">
                        Hospital Hanga Roa Digital Twin v1.0
                    </div>
                    <div className="bg-white/80 backdrop-blur p-2 rounded-lg shadow-sm border border-slate-200">
                        <p>🖱️ Click + Mover para rotar cámara</p>
                        <p>🖱️ Scroll para zoom</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HospitalFloorMap;
