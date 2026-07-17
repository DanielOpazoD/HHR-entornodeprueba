import React from 'react';
import { ClipboardList } from 'lucide-react';
import { CUDYR_NIGHT_REFERENCE_TIME_LABEL } from '@/features/cudyr/public';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';

export const HandoffCudyrPrintHeader: React.FC<{
  categorized: number;
  index: number;
  occupied: number;
  printDate: string;
  applicationDate: string;
  responsibleNurses: string[];
  recordedAt?: string;
  recordedBy?: string;
}> = ({
  categorized,
  index,
  occupied,
  printDate,
  applicationDate,
  responsibleNurses,
  recordedAt,
  recordedBy,
}) => (
  <div className="mb-3 border-b border-slate-300 pb-3">
    <div className="mb-1 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
        <ClipboardList size={18} className="text-medical-700 print:hidden" />
        Instrumento CUDYR del último registro disponible
      </h2>
      <div className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold print:border-slate-300 print:bg-white">
        <div className="flex flex-col items-center leading-none">
          <span className="mb-0.5 text-[8px] uppercase tracking-tighter text-slate-400">
            Ocupadas
          </span>
          <span className="text-sm text-slate-700">{occupied}</span>
        </div>
        <div className="h-5 w-px self-center bg-slate-200"></div>
        <div className="flex flex-col items-center leading-none">
          <span className="mb-0.5 text-[8px] uppercase tracking-tighter text-slate-400">
            Categ.
          </span>
          <span className="text-sm text-blue-600">{categorized}</span>
        </div>
        <div className="h-5 w-px self-center bg-slate-200"></div>
        <div className="flex flex-col items-center leading-none">
          <span className="mb-0.5 text-[8px] uppercase tracking-tighter text-slate-400">
            Índice
          </span>
          <span className="text-sm text-slate-700">{index}%</span>
        </div>
      </div>
    </div>

    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-700">
      <span className="font-semibold">Último registro disponible: {printDate}</span>

      <span className="text-slate-400">|</span>
      <span>
        <span className="font-semibold">Fecha y hora de corte de aplicación: </span>
        {applicationDate}, {CUDYR_NIGHT_REFERENCE_TIME_LABEL}
      </span>

      <span className="text-slate-400">|</span>
      <span>
        <span className="font-semibold">Enfermeros/as (Noche): </span>
        {responsibleNurses.length > 0 ? (
          responsibleNurses.join(', ')
        ) : (
          <span className="italic text-slate-400">No registrados</span>
        )}
      </span>

      {(recordedBy || recordedAt) && (
        <>
          <span className="text-slate-400">|</span>
          <span title="Responsable y hora del último registro CUDYR confirmado">
            <span className="font-semibold">Registro CUDYR: </span>
            {recordedBy || 'Profesional no informado'}
            {recordedAt ? ` · ${formatDateTimeCL(recordedAt)}` : ''}
          </span>
        </>
      )}
    </div>
  </div>
);
