import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { SavedLayout } from '@/features/census/controllers/hospitalFloorMapRuntimeController';

interface HospitalFloorMapConfigPanelProps {
  config: SavedLayout['config'];
  onBedWidthChange: (value: number) => void;
  onBedLengthChange: (value: number) => void;
  onColorFreeChange: (value: string) => void;
  onColorOccupiedChange: (value: string) => void;
  onReset: () => void;
  onSave: () => void;
}

export const HospitalFloorMapConfigPanel: React.FC<HospitalFloorMapConfigPanelProps> = ({
  config,
  onBedWidthChange,
  onBedLengthChange,
  onColorFreeChange,
  onColorOccupiedChange,
  onReset,
  onSave,
}) => (
  <div className="absolute top-16 right-4 bg-white/95 backdrop-blur p-4 rounded-xl shadow-xl border border-slate-200 w-64 animate-scale-in z-10 pointer-events-auto">
    <h3 className="text-xs font-bold uppercase text-slate-400 mb-3 tracking-wider">Apariencia</h3>

    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-700">Dimensión Camas</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">Ancho</span>
            <input
              type="number"
              step="0.1"
              value={config.bedWidth}
              onChange={event => onBedWidthChange(Number.parseFloat(event.target.value))}
              className="w-full px-2 py-1 bg-slate-50 border rounded text-xs"
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">Largo</span>
            <input
              type="number"
              step="0.1"
              value={config.bedLength}
              onChange={event => onBedLengthChange(Number.parseFloat(event.target.value))}
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
            value={config.colorFree}
            onChange={event => onColorFreeChange(event.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Ocupada</span>
          <input
            type="color"
            value={config.colorOccupied}
            onChange={event => onColorOccupiedChange(event.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0"
          />
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 flex justify-between">
        <button
          onClick={onReset}
          className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
        >
          <RotateCcw size={12} /> Reset
        </button>
        <button
          onClick={onSave}
          className="text-xs bg-slate-900 text-white px-3 py-1 rounded hover:bg-black transition-colors"
        >
          Guardar
        </button>
      </div>
    </div>
  </div>
);
