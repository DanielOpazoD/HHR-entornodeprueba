import React from 'react';
import { MousePointer2, Search, ZoomIn, ZoomOut } from 'lucide-react';

interface HospitalFloorMapZoomControlsProps {
  zoomValue: number;
  isEditMode: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export const HospitalFloorMapZoomControls: React.FC<HospitalFloorMapZoomControlsProps> = ({
  zoomValue,
  isEditMode,
  onZoomIn,
  onZoomOut,
}) => (
  <div className="absolute top-4 left-4 flex flex-col gap-2">
    <div className="bg-white/90 backdrop-blur p-1 rounded-lg shadow-sm border border-slate-200 flex flex-col gap-1 pointer-events-auto overflow-hidden">
      <button
        onClick={onZoomIn}
        className="p-1.5 hover:bg-slate-100 text-slate-500 rounded transition-colors"
        title="Acercar"
      >
        <ZoomIn size={18} />
      </button>
      <div className="h-px bg-slate-100 mx-1" />
      <div className="flex flex-col items-center justify-center py-1">
        <Search size={10} className="text-slate-300 mb-0.5" />
        <span className="text-[10px] font-bold text-slate-600 tabular-nums">{zoomValue}%</span>
      </div>
      <div className="h-px bg-slate-100 mx-1" />
      <button
        onClick={onZoomOut}
        className="p-1.5 hover:bg-slate-100 text-slate-500 rounded transition-colors"
        title="Alejar"
      >
        <ZoomOut size={18} />
      </button>
    </div>

    {isEditMode && (
      <div className="bg-indigo-600/90 backdrop-blur text-white px-3 py-1.5 rounded-lg shadow-lg text-xs font-bold animate-pulse flex items-center gap-2 pointer-events-auto">
        <MousePointer2 size={14} />
        Libertad de Movimiento
      </div>
    )}
  </div>
);
