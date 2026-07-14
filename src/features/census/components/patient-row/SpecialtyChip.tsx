/**
 * SpecialtyChip — the patient's clinical specialty shown next to "FI:" in the identity cell.
 *
 * Rediseño 2026: each specialty gets its own color so the census reads at a glance. When a patient
 * has no specialty yet, it shows an amber "Pendiente asignar" chip; clicking either chip opens a
 * small popover to pick/change it. The value is written through the same field handler the diagnosis
 * editor uses (`onAssign` → onNameChange('specialty')), so it coalesces and persists identically.
 */

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  SPECIALTY_OPTIONS,
  SPECIALTY_CHIP_STYLES,
  SPECIALTY_CHIP_FALLBACK,
} from '@/constants/clinicalSpecialtyConstants';

interface SpecialtyChipProps {
  specialty: string;
  readOnly?: boolean;
  onAssign: (value: string) => void;
}

const styleFor = (specialty: string): string =>
  SPECIALTY_CHIP_STYLES[specialty] ?? SPECIALTY_CHIP_FALLBACK;

export const SpecialtyChip: React.FC<SpecialtyChipProps> = ({
  specialty,
  readOnly = false,
  onAssign,
}) => {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const trimmed = specialty.trim();
  const assigned = trimmed.length > 0;

  const select = (value: string): void => {
    onAssign(value);
    setOpen(false);
  };

  const chip = assigned ? (
    <span
      className={clsx(
        'truncate rounded px-1 py-px text-[9px] font-medium ring-1',
        styleFor(trimmed),
        !readOnly && 'cursor-pointer'
      )}
    >
      {trimmed}
    </span>
  ) : (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded border border-dashed border-amber-300 bg-amber-50/60 px-1 py-px text-[9px] font-medium text-amber-600',
        !readOnly && 'cursor-pointer hover:bg-amber-100'
      )}
    >
      Pendiente asignar
    </span>
  );

  if (readOnly) {
    return (
      <span
        className="flex min-w-0 items-center gap-1"
        title={assigned ? `Especialidad: ${trimmed}` : 'Sin especialidad'}
      >
        {chip}
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          setOpen(current => !current);
        }}
        className="inline-flex min-w-0 items-center"
        title={assigned ? `Especialidad: ${trimmed}` : 'Asignar especialidad'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {chip}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-[60] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Asignar especialidad"
            className="absolute left-0 top-full z-[61] mt-1 w-36 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg"
          >
            <div className="flex flex-col">
              {SPECIALTY_OPTIONS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => select(option)}
                  className={clsx(
                    'flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-50',
                    option === trimmed && 'font-semibold'
                  )}
                >
                  <span
                    className={clsx('h-2 w-2 shrink-0 rounded-full ring-1', styleFor(option))}
                  />
                  {option}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
};
