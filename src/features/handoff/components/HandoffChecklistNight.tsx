import React from 'react';
import { ClipboardList, Pill } from 'lucide-react';
import { HandoffChecklistItem as ChecklistItem } from './HandoffChecklistItem';

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

export const HandoffChecklistNight: React.FC<HandoffChecklistNightProps> = ({
  data = {},
  onUpdate,
  readOnly = false,
}) => {
  return (
    <div className="handoff-checklist">
      <div className="flex items-center gap-1 text-slate-400 shrink-0 print:w-auto print:text-slate-700">
        <ClipboardList size={13} className="print:w-3 print:h-3" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide print:font-bold print:tracking-normal print:text-black print:text-[9px]">
          Checklist
        </span>
      </div>
      <div className="handoff-checklist-items">
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
        <div className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 print:flex-nowrap print:gap-1">
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
          <label className="inline-flex min-w-0 items-center gap-1.5 print:gap-0.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide print:tracking-normal print:text-[7px] print:text-black">
              Próx:
            </span>
            <input
              type="date"
              aria-label="Próximo conteo de medicamentos no controlados"
              value={data.conteoNoControladosProximaFecha || ''}
              onChange={e => onUpdate('conteoNoControladosProximaFecha', e.target.value)}
              className="h-7 min-w-0 w-[7.75rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500 print:hidden"
              disabled={readOnly}
            />
            {/* Print-only: show date as text without calendar icon */}
            <span className="hidden print:inline print:text-[8px] print:text-black">
              {data.conteoNoControladosProximaFecha || '-'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};
