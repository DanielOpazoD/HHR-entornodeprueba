import React from 'react';
import clsx from 'clsx';
import type { RowMenuAlign } from './patientRowUiContracts';
import type { MouseEventHandler } from 'react';

interface PatientBedConfigMenuPanelProps {
  align: RowMenuAlign;
  bedModeModel: {
    label: string;
    emoji: string;
    className: string;
    dotClassName: string;
  };
  companionModel: {
    className: string;
    dotClassName: string;
  };
  clinicalCribModel: {
    className: string;
    dotClassName: string;
  };
  showClinicalCribToggle: boolean;
  showClinicalCribActions: boolean;
  showLegacyCribCleanup: boolean;
  onToggleMode: () => void;
  onToggleCompanion: () => void;
  onToggleClinicalCrib: () => void;
  onRemoveClinicalCrib: MouseEventHandler<HTMLButtonElement>;
}

export const PatientBedConfigMenuPanel: React.FC<PatientBedConfigMenuPanelProps> = ({
  align,
  bedModeModel,
  clinicalCribModel,
  showClinicalCribToggle,
  showClinicalCribActions,
  showLegacyCribCleanup,
  onToggleMode,
  onToggleCompanion,
  onToggleClinicalCrib,
  onRemoveClinicalCrib,
}) => (
  <div
    className={clsx(
      'absolute left-0 w-56 bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden animate-scale-in',
      align === 'top' ? 'top-full mt-1' : 'bottom-full mb-1'
    )}
  >
    <div className="p-1.5 flex flex-col gap-1">
      <div className="px-2 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-0.5 flex justify-between items-center">
        <span>Opciones</span>
        <span>⚙️</span>
      </div>

      <button onClick={onToggleMode} className={bedModeModel.className}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{bedModeModel.emoji}</span>
          <span className="text-left leading-none">{bedModeModel.label}</span>
        </div>
        <div className={bedModeModel.dotClassName} />
      </button>

      {showClinicalCribToggle && (
        <button onClick={onToggleClinicalCrib} className={clinicalCribModel.className}>
          <div className="flex items-center gap-2">
            <span className="text-sm">➕</span>
            <span>Agregar Cuna Clínica</span>
          </div>
          <div className={clinicalCribModel.dotClassName} />
        </button>
      )}

      {showLegacyCribCleanup && (
        <button
          onClick={onToggleCompanion}
          className="text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center gap-2 w-full bg-amber-50 text-amber-800 hover:bg-amber-100"
          title="Elimina una marca antigua; no clasifica al recién nacido"
        >
          <span className="text-sm">🧹</span>
          <span className="text-left">Limpiar marca histórica de cuna</span>
        </button>
      )}

      {showClinicalCribActions && (
        <div className="flex gap-1 mt-1 border-t border-slate-100 pt-1.5 px-0.5">
          <button
            onClick={onRemoveClinicalCrib}
            className="flex-shrink-0 bg-red-50 hover:bg-red-100 text-red-500 p-2 rounded-md transition-all border border-red-100"
            title="Eliminar Cuna"
          >
            <span className="text-xs">🗑️</span>
          </button>
        </div>
      )}
    </div>
  </div>
);
