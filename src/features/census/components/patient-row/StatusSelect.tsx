/**
 * StatusSelect — patient clinical status (critical field), rendered as a compact colored dot
 * (rediseño "centro de vigilancia" 2026): green (estable) · amber (de cuidado) · red (grave), with a
 * pulsing red marker when the status is missing for an admitted patient. Clicking opens a small
 * popover that names the current status and lets the nurse change it. Still fully editable.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import { STATUS_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { BaseCellProps, EventTextHandler } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';

interface StatusSelectProps extends BaseCellProps {
  onChange: EventTextHandler;
}

type StatusLevel = 'grave' | 'cuidado' | 'estable' | 'none';

const statusLevel = (status: string): StatusLevel => {
  if (status === 'Grave') return 'grave';
  if (status === 'De cuidado') return 'cuidado';
  if (status) return 'estable';
  return 'none';
};

const DOT_CLASSES: Record<StatusLevel, string> = {
  grave: 'bg-red-500',
  cuidado: 'bg-amber-400',
  estable: 'bg-emerald-500',
  none: 'bg-slate-300',
};

const RING_CLASSES: Record<StatusLevel, string> = {
  grave: 'ring-red-200',
  cuidado: 'ring-amber-200',
  estable: 'ring-emerald-200',
  none: 'ring-slate-200',
};

export const StatusSelect: React.FC<StatusSelectProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  readOnlyReason,
  clinicalPause,
  onChange,
}) => {
  const freshnessPause = useClinicalFieldFreshnessPause(clinicalPause);
  const [open, setOpen] = useState(false);
  const isCriticalEmpty = !data.status && !!data.patientName;

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 w-9" />;
  }

  const status = data.status || '';
  const level = statusLevel(status);

  const selectStatus = (value: string): void => {
    // Reuse the existing field handler by synthesizing the change event it expects.
    onChange('status')({
      target: { value },
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  return (
    <td
      className="py-0.5 px-1 border-r border-slate-200 w-9 text-center"
      onMouseDownCapture={freshnessPause.acknowledge}
      onFocusCapture={freshnessPause.acknowledge}
    >
      <div className="relative inline-flex">
        <button
          type="button"
          name="status"
          onClick={e => {
            e.stopPropagation();
            if (!readOnly) setOpen(o => !o);
          }}
          disabled={readOnly}
          className={clsx(
            'relative inline-flex h-5 w-5 items-center justify-center rounded-full ring-2 transition-transform',
            RING_CLASSES[level],
            !readOnly && 'cursor-pointer hover:scale-110',
            freshnessPause.pauseClassName
          )}
          title={readOnlyReason || (status ? `Estado: ${status}` : 'Sin estado clínico — asignar')}
          aria-label={status ? `Estado: ${status}` : 'Sin estado clínico'}
        >
          <span
            className={clsx(
              'h-3 w-3 rounded-full',
              DOT_CLASSES[level],
              isCriticalEmpty && 'animate-pulse'
            )}
          />
          {isCriticalEmpty && (
            <span
              className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500"
              title="Campo crítico vacío"
            >
              <AlertCircle size={8} className="text-white" />
            </span>
          )}
        </button>

        {open && (
          <>
            {/* Click-away backdrop */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-label="Estado clínico"
              className="absolute left-1/2 top-full z-20 mt-1 w-32 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg"
            >
              <div className="px-1.5 py-1 text-[11px] font-semibold text-slate-700">
                {status || 'Sin estado'}
              </div>
              {!readOnly && (
                <div className="flex flex-col">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => selectStatus(opt)}
                      className={clsx(
                        'flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-50',
                        opt === status && 'bg-slate-50 font-semibold'
                      )}
                    >
                      <span
                        className={clsx(
                          'h-2 w-2 shrink-0 rounded-full',
                          DOT_CLASSES[statusLevel(opt)]
                        )}
                      />
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {freshnessPause.hint}
      </div>
    </td>
  );
};
