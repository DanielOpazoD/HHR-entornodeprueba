import React from 'react';
import { LucideIcon } from 'lucide-react';
import type { ShiftSchedule } from '@/utils/clinicalDayUtils';

export const resolvePrintableShiftLabel = (
  selectedShift: 'day' | 'night' | undefined,
  schedule: Pick<ShiftSchedule, 'dayStart' | 'dayEnd' | 'nightStart' | 'nightEnd'> | undefined
): string | null => {
  if (!schedule) {
    return null;
  }

  return selectedShift === 'day'
    ? `Turno Largo (${schedule.dayStart} - ${schedule.dayEnd})`
    : `Turno Noche (${schedule.nightStart} - ${schedule.nightEnd})`;
};

export const resolvePrintableStaffList = (
  values: string[] | undefined,
  fallback: string
): { text: string; isFallback: boolean } => {
  const normalized = (values || []).filter(Boolean).join(', ');
  return normalized
    ? { text: normalized, isFallback: false }
    : { text: fallback, isFallback: true };
};

interface HandoffPrintHeaderProps {
  title: string;
  dateString: string;
  Icon: LucideIcon;
  schedule?: Pick<ShiftSchedule, 'dayStart' | 'dayEnd' | 'nightStart' | 'nightEnd'>;
  selectedShift?: 'day' | 'night';
  deliversList?: string[];
  receivesList?: string[];
  tensList?: string[];
}

const EMPTY_STRING_ARRAY: string[] = [];

export const HandoffPrintHeader: React.FC<HandoffPrintHeaderProps> = React.memo(
  function HandoffPrintHeader({
    title,
    dateString,
    Icon: _Icon,
    schedule,
    selectedShift,
    deliversList = EMPTY_STRING_ARRAY,
    receivesList = EMPTY_STRING_ARRAY,
    tensList = EMPTY_STRING_ARRAY,
  }) {
    const delivers = resolvePrintableStaffList(deliversList, 'Sin especificar');
    const receives = resolvePrintableStaffList(receivesList, 'Sin especificar');
    const tens = resolvePrintableStaffList(tensList, 'Sin registro');

    return (
      <div className="hidden print:block mb-4 pb-4 border-b-2 border-slate-800">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-start gap-4">
            <img
              src="/images/logos/logo_HHR.svg"
              alt="Logo HHR"
              className="w-12 h-12 print:w-10 print:h-10 object-contain shadow-sm border border-slate-100 p-1 print:p-0 print:border-0 print:shadow-none"
            />
            <div>
              <h1 className="text-2xl print:text-lg font-bold text-slate-900 uppercase tracking-tight">
                {title}
              </h1>
              <p className="text-sm text-slate-600 font-medium mt-1 uppercase tracking-wide print:text-xs">
                Servicio Hospitalizados Hanga Roa
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl print:text-base font-bold text-slate-900">{dateString}</div>
            {schedule && (
              <div className="text-sm text-slate-600 uppercase print:text-xs">
                {resolvePrintableShiftLabel(selectedShift, schedule)}
              </div>
            )}
          </div>
        </div>

        {/* Print: Show Responsible Nurses & TENS */}
        <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-4 text-xs border-t border-slate-300 pt-3">
          <div className="min-w-0">
            <span className="block font-bold text-slate-900 uppercase text-[9px] mb-0.5">
              Enfermero(a) Entrega:
            </span>
            <div className="text-slate-800 text-[10px] break-words">
              {delivers.isFallback ? (
                <span className="italic text-slate-400">{delivers.text}</span>
              ) : (
                delivers.text
              )}
            </div>
          </div>
          <div className="min-w-0">
            <span className="block font-bold text-slate-900 uppercase text-[9px] mb-0.5">
              Enfermero(a) Recibe:
            </span>
            <div className="text-slate-800 text-[10px] break-words">
              {receives.isFallback ? (
                <span className="italic text-slate-400">{receives.text}</span>
              ) : (
                receives.text
              )}
            </div>
          </div>
          <div className="min-w-0 border-l border-slate-100 pl-4">
            <span className="block font-bold text-slate-900 uppercase text-[9px] mb-0.5">
              TENS de Turno:
            </span>
            <div className="text-slate-800 text-[10px] break-words font-medium">
              {tens.isFallback ? (
                <span className="italic text-slate-400">{tens.text}</span>
              ) : (
                tens.text
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
