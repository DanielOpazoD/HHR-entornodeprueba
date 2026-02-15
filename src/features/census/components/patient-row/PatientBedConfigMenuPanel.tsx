import React from 'react';
import clsx from 'clsx';
import type { RowMenuAlign } from './patientRowContracts';
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
  onToggleMode: () => void;
  onToggleCompanion: () => void;
  onToggleClinicalCrib: () => void;
  onRemoveClinicalCrib: MouseEventHandler<HTMLButtonElement>;
}

export const PatientBedConfigMenuPanel: React.FC<PatientBedConfigMenuPanelProps> = ({
  align,
  bedModeModel,
  companionModel,
  clinicalCribModel,
  showClinicalCribToggle,
  showClinicalCribActions,
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

      <button onClick={onToggleCompanion} className={companionModel.className}>
        <div className="flex items-center gap-2">
          <span className="text-sm">🤱</span>
          <span>RN Sano</span>
        </div>
        <div className={companionModel.dotClassName} />
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
