import React from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

interface ClinicalPanelHeadingProps {
  patientName: string;
  bedId: string;
  isWide: boolean;
  onToggleWidth: () => void;
  onClose: () => void;
}

export const ClinicalPanelHeading: React.FC<ClinicalPanelHeadingProps> = ({
  patientName,
  bedId,
  isWide,
  onToggleWidth,
  onClose,
}) => (
  <div className="flex items-start gap-2">
    <div className="min-w-0 flex-1">
      <h2 className="break-words text-[14px] font-semibold leading-snug text-slate-800">
        {patientName}
      </h2>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Cama {bedId} · Eloísa en vivo · no se guarda en HHR
      </p>
    </div>
    <button
      type="button"
      onClick={onToggleWidth}
      aria-pressed={isWide}
      aria-label={isWide ? 'Reducir panel de lectura' : 'Ampliar panel de lectura'}
      title={isWide ? 'Reducir lectura' : 'Ampliar lectura'}
      className="hidden size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700"
    >
      {isWide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
    <button
      type="button"
      onClick={onClose}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700"
      title="Cerrar"
      aria-label="Cerrar panel clínico"
    >
      <X size={16} />
    </button>
  </div>
);
