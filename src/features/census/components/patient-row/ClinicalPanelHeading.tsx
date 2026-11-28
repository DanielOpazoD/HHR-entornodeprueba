import React from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { formatAge } from '@/utils/ageDisplayUtils';
import { calculateOperationalHospitalizedDays } from '@/utils/clinicalDayUtils';

interface ClinicalPanelHeadingProps {
  patientName: string;
  bedId: string;
  patientAge?: string;
  diagnosis?: string;
  admissionDate?: string;
  censusDate?: string;
  isWide: boolean;
  onToggleWidth: () => void;
  onClose: () => void;
}

export const ClinicalPanelHeading: React.FC<ClinicalPanelHeadingProps> = ({
  patientName,
  bedId,
  patientAge,
  diagnosis,
  admissionDate,
  censusDate,
  isWide,
  onToggleWidth,
  onClose,
}) => {
  const formattedAge = formatAge(patientAge);
  const hospitalizedDays =
    admissionDate && censusDate
      ? calculateOperationalHospitalizedDays(admissionDate, censusDate)
      : null;
  const cleanDiagnosis = diagnosis?.trim() ?? '';

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-[14px] font-semibold leading-snug text-slate-800">
          {patientName}
        </h2>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-snug text-slate-500">
          <span className="shrink-0">Cama {bedId}</span>
          {formattedAge && (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0 tabular-nums">{formattedAge}</span>
            </>
          )}
          {hospitalizedDays !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0 tabular-nums">
                {hospitalizedDays} {hospitalizedDays === 1 ? 'día' : 'días'}
              </span>
            </>
          )}
          {cleanDiagnosis && (
            <>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate" title={cleanDiagnosis}>
                {cleanDiagnosis}
              </span>
            </>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggleWidth}
        aria-pressed={isWide}
        aria-label={isWide ? 'Reducir panel de lectura' : 'Ampliar panel de lectura'}
        title={isWide ? 'Reducir lectura' : 'Ampliar lectura'}
        className="hidden size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
      >
        {isWide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
        title="Cerrar"
        aria-label="Cerrar panel clínico"
      >
        <X size={16} />
      </button>
    </div>
  );
};
