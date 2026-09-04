import React from 'react';
import { PatientRowMenuPortal } from './PatientRowMenuPortal';
import type { RowMenuAlign } from './patientRowUiContracts';
import type { MouseEventHandler } from 'react';

interface PatientBedConfigMenuPanelProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  align: RowMenuAlign;
  clinicalCribModel: {
    className: string;
    dotClassName: string;
  };
  showClinicalCribToggle: boolean;
  showClinicalCribActions: boolean;
  showLegacyCompanionCleanup: boolean;
  onToggleClinicalCrib: () => void;
  onClearLegacyCompanion: () => void;
  onRemoveClinicalCrib: MouseEventHandler<HTMLButtonElement>;
}

export const PatientBedConfigMenuPanel: React.FC<PatientBedConfigMenuPanelProps> = ({
  anchorRef,
  onClose,
  align,
  clinicalCribModel,
  showClinicalCribToggle,
  showClinicalCribActions,
  showLegacyCompanionCleanup,
  onToggleClinicalCrib,
  onClearLegacyCompanion,
  onRemoveClinicalCrib,
}) => (
  <PatientRowMenuPortal anchorRef={anchorRef} align={align} onClose={onClose}>
    <div className="w-56 bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden">
      <div className="p-1.5 flex flex-col gap-1">
        <div className="px-2 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-0.5 flex justify-between items-center">
          <span>Opciones</span>
          <span>⚙️</span>
        </div>

        {showLegacyCompanionCleanup && (
          <button
            onClick={onClearLegacyCompanion}
            className="flex items-center justify-between rounded-md bg-amber-50 px-2 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            <span>Quitar dato RN sano antiguo</span>
            <span aria-hidden="true">×</span>
          </button>
        )}

        {showClinicalCribToggle && (
          <button onClick={onToggleClinicalCrib} className={clinicalCribModel.className}>
            <div className="flex items-center gap-2">
              <span className="text-sm">➕</span>
              <span>Agregar Cuna</span>
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
  </PatientRowMenuPortal>
);
