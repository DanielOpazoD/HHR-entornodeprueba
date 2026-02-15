import React from 'react';

interface HospitalFloorMapLegendProps {
  isEditMode: boolean;
  showConfig: boolean;
}

export const HospitalFloorMapLegend: React.FC<HospitalFloorMapLegendProps> = ({
  isEditMode,
  showConfig,
}) => {
  if (isEditMode || showConfig) {
    return null;
  }

  return (
    <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none text-[10px] text-slate-400">
      <div className="bg-white/50 backdrop-blur px-2 py-1 rounded border border-white/40">
        Hospital Hanga Roa Digital Twin v1.0
      </div>
      <div className="bg-white/80 backdrop-blur p-2 rounded-lg shadow-sm border border-slate-200">
        <p>🖱️ Click + Mover para rotar cámara</p>
        <p>🖱️ Scroll para zoom</p>
      </div>
    </div>
  );
};
