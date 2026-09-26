/**
 * StatusSelect — patient clinical status (critical field), rendered as a compact colored dot
 * (rediseño "centro de vigilancia" 2026): green (estable) · amber (de cuidado) · red (grave), with a
 * pulsing red marker when the status is missing for an admitted patient. Clicking opens a small
 * popover that names the current status and lets the nurse change it. Still fully editable.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { STATUS_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { BaseCellProps, EventTextHandler } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const closePopover = useCallback((): void => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const resolvePosition = useCallback(() => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return null;
    const width = popoverRef.current?.offsetWidth ?? 128;
    const height = popoverRef.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 4;
    const preferredTop = below + height <= window.innerHeight - 8 ? below : anchor.top - height - 4;
    return {
      top: Math.max(8, Math.min(preferredTop, window.innerHeight - height - 8)),
      left: Math.max(
        8,
        Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8)
      ),
    };
  }, []);
  const { position } = usePortalPopoverRuntime({
    isOpen: open,
    anchorRef: buttonRef,
    popoverRef,
    initialPosition: { top: 8, left: 8 },
    resolvePosition,
    onClose: closePopover,
  });

  // Focus the first option when the portal opens; the shared runtime closes on Escape/outside click.
  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-0.5 border-r border-slate-200 w-4" />;
  }

  const status = data.status || '';
  const level = statusLevel(status);

  const selectStatus = (value: string): void => {
    // Reuse the existing field handler by synthesizing the change event it expects.
    onChange('status')({
      target: { value },
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
    closePopover();
  };

  return (
    <td
      className="py-0.5 px-0.5 border-r border-slate-200 w-4 text-center"
      onMouseDownCapture={freshnessPause.acknowledge}
      onFocusCapture={freshnessPause.acknowledge}
    >
      <div className="relative inline-flex">
        <button
          ref={buttonRef}
          type="button"
          name="status"
          data-testid="clinical-status"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={e => {
            e.stopPropagation();
            if (!readOnly) setOpen(o => !o);
          }}
          disabled={readOnly}
          className={clsx(
            'relative inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ring-1 transition-transform',
            RING_CLASSES[level],
            !readOnly && 'cursor-pointer hover:scale-110',
            freshnessPause.pauseClassName
          )}
          title={readOnlyReason || (status ? `Estado: ${status}` : 'Sin estado clínico — asignar')}
          aria-label={status ? `Estado: ${status}` : 'Sin estado clínico'}
        >
          <span className={clsx('h-2 w-2 rounded-full', DOT_CLASSES[level])} />
        </button>

        {open &&
          createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Estado clínico"
              className="fixed z-[110] max-h-[calc(100vh-16px)] w-32 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg print:hidden"
              style={position}
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
            </div>,
            document.body
          )}
        {freshnessPause.hint}
      </div>
    </td>
  );
};
