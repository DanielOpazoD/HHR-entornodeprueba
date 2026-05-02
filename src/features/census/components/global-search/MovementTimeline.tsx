/**
 * MovementTimeline
 *
 * Renders the recent patient movement history (admissions, internal moves,
 * discharges, transfers) from the patientHistoryService.
 */

import React from 'react';
import { LogIn, LogOut, ArrowRightLeft, BedDouble, CalendarDays } from 'lucide-react';
import type { PatientMovement } from '@/services/patient/patientHistoryService';
import { formatDateToCL } from '@/utils/clinicalUtils';

interface MovementTimelineProps {
  movements: PatientMovement[];
}

const MAX_VISIBLE_MOVEMENTS = 10;

const movementIcon = (type: string) => {
  switch (type) {
    case 'admission':
      return <LogIn size={12} className="text-emerald-600" />;
    case 'discharge':
      return <LogOut size={12} className="text-rose-600" />;
    case 'transfer':
      return <ArrowRightLeft size={12} className="text-amber-600" />;
    case 'internal_move':
      return <BedDouble size={12} className="text-blue-600" />;
    default:
      return <CalendarDays size={12} className="text-slate-400" />;
  }
};

const movementLabel = (type: string): string => {
  switch (type) {
    case 'admission':
      return 'Ingreso';
    case 'discharge':
      return 'Egreso';
    case 'transfer':
      return 'Traslado';
    case 'internal_move':
      return 'Cambio de cama';
    default:
      return 'Estadia';
  }
};

export const MovementTimeline: React.FC<MovementTimelineProps> = ({ movements }) => {
  if (movements.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
        Movimientos recientes
      </h4>
      <div className="space-y-0.5">
        {movements.slice(-MAX_VISIBLE_MOVEMENTS).map((m, i) => {
          const isInternalMove = m.type === 'internal_move';

          return (
            <div
              key={`${m.date}-${m.bedId}-${i}`}
              data-testid={`movement-row-${m.type}-${i}`}
              className={[
                'flex items-center gap-2 text-xs',
                isInternalMove ? 'ml-7 border-l border-slate-200 pl-3 py-0.5' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {movementIcon(m.type)}
              <span className="text-slate-500 font-mono text-[10px] w-20 shrink-0">
                {formatDateToCL(m.date)}
              </span>
              <span
                className={
                  isInternalMove ? 'font-medium text-slate-600' : 'font-medium text-slate-700'
                }
              >
                {movementLabel(m.type)}
              </span>
              <span className="text-slate-400 truncate">
                {m.bedName}
                {m.details ? ` — ${m.details}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
