import React from 'react';
import { ClipboardList, Pill } from 'lucide-react';
import clsx from 'clsx';

interface HandoffChecklistNightProps {
  data?: {
    estadistica?: boolean;
    categorizacionCudyr?: boolean;
    encuestaUTI?: boolean;
    encuestaMedias?: boolean;
    conteoMedicamento?: boolean;
    conteoMedicamentoProximaFecha?: string;
    conteoNoControlados?: boolean;
    conteoNoControladosProximaFecha?: string;
  };
  onUpdate: (field: string, value: boolean | string) => void;
  readOnly?: boolean;
}

/**
 * Reusable checkbox component that renders correctly in both screen and print
 * Uses conditional classes instead of :checked pseudo-class for print compatibility
 */
const ChecklistItem: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled: boolean;
}> = ({ checked, onChange, label, disabled }) => {
  return (
    <label className="flex min-h-8 min-w-0 items-center gap-2 cursor-pointer group print:min-h-0 print:gap-1">
      <div className="relative flex shrink-0 items-center">
        <input
          type="checkbox"
          className={clsx(
            'h-4 w-4 cursor-pointer appearance-none rounded border shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-default print:shadow-none',
            'print:w-3 print:h-3 print:shadow-none',
            'border-slate-300 focus-visible:ring-slate-400',
            // For screen: use :checked pseudo-class
            'checked:border-slate-600 checked:bg-slate-600',
            // For print: use conditional classes directly (these will always apply when checked)
            checked && 'print:!bg-slate-800 print:!border-slate-800'
          )}
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
        />
        {/* Checkmark - visible when checked, works for both screen and print */}
        <span
          className={clsx(
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white pointer-events-none transition-opacity',
            checked ? 'opacity-100' : 'opacity-0'
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3 print:h-2 print:w-2"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            stroke="currentColor"
            strokeWidth="1"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </div>
      <span className="text-slate-700 font-medium leading-4 group-hover:text-slate-900 transition-colors text-xs print:text-[8px] print:text-black">
        {label}
      </span>
    </label>
  );
};

export const HandoffChecklistNight: React.FC<HandoffChecklistNightProps> = ({
  data = {},
  onUpdate,
  readOnly = false,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 print:mt-0 print:flex-nowrap print:gap-3 print:bg-transparent print:border-none print:p-0">
      <div className="flex w-full items-center gap-2 text-slate-500 shrink-0 lg:w-auto print:w-auto print:text-slate-700">
        <ClipboardList size={14} className="print:w-3 print:h-3" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide print:font-bold print:tracking-normal print:text-black print:text-[9px]">
          Checklist
        </span>
      </div>
      <ChecklistItem
        checked={!!data.estadistica}
        onChange={checked => onUpdate('estadistica', checked)}
        label="Estadística"
        disabled={readOnly}
      />
      <ChecklistItem
        checked={!!data.categorizacionCudyr}
        onChange={checked => onUpdate('categorizacionCudyr', checked)}
        label="CUDYR"
        disabled={readOnly}
      />
      <ChecklistItem
        checked={!!data.encuestaUTI}
        onChange={checked => onUpdate('encuestaUTI', checked)}
        label="Encuesta camas UTI"
        disabled={readOnly}
      />
      <ChecklistItem
        checked={!!data.encuestaMedias}
        onChange={checked => onUpdate('encuestaMedias', checked)}
        label="Encuesta camas Medias"
        disabled={readOnly}
      />
      <ChecklistItem
        checked={!!data.conteoMedicamento}
        onChange={checked => onUpdate('conteoMedicamento', checked)}
        label={
          <>
            Conteo{' '}
            <Pill
              size={12}
              className="inline align-[-2px] text-slate-500 print:hidden"
              aria-hidden="true"
            />
            <span className="hidden print:inline">💊 </span>controlados
          </>
        }
        disabled={readOnly}
      />

      {/* Conteo Fármacos NO Controlados + Fecha */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 print:flex-nowrap print:gap-1">
        <ChecklistItem
          checked={!!data.conteoNoControlados}
          onChange={checked => onUpdate('conteoNoControlados', checked)}
          label={
            <>
              Conteo{' '}
              <Pill
                size={12}
                className="inline align-[-2px] text-slate-500 print:hidden"
                aria-hidden="true"
              />
              <span className="hidden print:inline">💊 </span>no-controlados
            </>
          }
          disabled={readOnly}
        />
        <label className="flex min-w-0 items-center gap-2 print:gap-0.5">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide print:tracking-normal print:text-[7px] print:text-black">
            Próx:
          </span>
          <input
            type="date"
            aria-label="Próximo conteo de medicamentos no controlados"
            value={data.conteoNoControladosProximaFecha || ''}
            onChange={e => onUpdate('conteoNoControladosProximaFecha', e.target.value)}
            className="h-8 min-w-0 w-32 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500 print:hidden"
            disabled={readOnly}
          />
          {/* Print-only: show date as text without calendar icon */}
          <span className="hidden print:inline print:text-[8px] print:text-black">
            {data.conteoNoControladosProximaFecha || '-'}
          </span>
        </label>
      </div>
    </div>
  );
};
