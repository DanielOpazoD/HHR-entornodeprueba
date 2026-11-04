import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { PatientRowMenuPortal } from './PatientRowMenuPortal';
import type { RowMenuAlign } from './patientRowUiContracts';
import type { MouseEventHandler } from 'react';

interface PatientBedConfigMenuPanelProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  align: RowMenuAlign;
  showClinicalCribToggle: boolean;
  showClinicalCribActions: boolean;
  showLegacyCompanionCleanup: boolean;
  onToggleClinicalCrib: () => void;
  onClearLegacyCompanion: () => void;
  onRemoveClinicalCrib: MouseEventHandler<HTMLButtonElement>;
}

/** Same look as the row actions menu: one section label and full-width items with line icons. */
const ITEM_CLASS =
  'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600';

export const PatientBedConfigMenuPanel: React.FC<PatientBedConfigMenuPanelProps> = ({
  anchorRef,
  onClose,
  align,
  showClinicalCribToggle,
  showClinicalCribActions,
  showLegacyCompanionCleanup,
  onToggleClinicalCrib,
  onClearLegacyCompanion,
  onRemoveClinicalCrib,
}) => (
  <PatientRowMenuPortal anchorRef={anchorRef} align={align} onClose={onClose}>
    <div className="w-64 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-left shadow-xl">
      <span className="block px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Cama
      </span>

      {showLegacyCompanionCleanup && (
        <button
          type="button"
          onClick={onClearLegacyCompanion}
          className={`${ITEM_CLASS} text-amber-800 hover:bg-amber-50`}
        >
          <X size={15} className="shrink-0" aria-hidden="true" />
          Quitar dato RN sano antiguo
        </button>
      )}

      {showClinicalCribToggle && (
        <button
          type="button"
          onClick={onToggleClinicalCrib}
          className={`${ITEM_CLASS} text-slate-700 hover:bg-slate-50`}
        >
          <Plus size={15} className="shrink-0 text-purple-600" aria-hidden="true" />
          Agregar cuna
        </button>
      )}

      {showClinicalCribActions && (
        <button
          type="button"
          onClick={onRemoveClinicalCrib}
          className={`${ITEM_CLASS} text-red-600 hover:bg-red-50`}
        >
          <Trash2 size={15} className="shrink-0" aria-hidden="true" />
          Eliminar cuna
        </button>
      )}
    </div>
  </PatientRowMenuPortal>
);
