import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
export const DateStripPeriodControl = ({
  kind,
  label,
  onPrevious,
  onNext,
  onToggle,
  containerRef,
  disabled,
  children,
}: {
  kind: 'year' | 'month';
  label: string | number;
  onPrevious?: () => void;
  onNext?: () => void;
  onToggle?: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  disabled?: boolean;
  children?: React.ReactNode;
}) => (
  <div
    className="hhr-toolbar-period relative flex h-[30px] items-center shrink-0 rounded-lg bg-slate-50 border border-slate-200/80 px-0 py-0.5"
    ref={containerRef}
  >
    <button
      type="button"
      disabled={disabled}
      onClick={onPrevious}
      aria-label={kind === 'year' ? 'Año anterior' : 'Mes anterior'}
      title={kind === 'year' ? 'Año anterior' : 'Mes anterior'}
      className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 transition-colors disabled:opacity-50"
    >
      <ChevronLeft size={12} aria-hidden="true" />
    </button>
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      title={kind === 'year' ? 'Seleccionar año' : 'Seleccionar mes'}
      className={
        kind === 'year'
          ? 'mx-0.5 text-[11px] font-semibold text-slate-600 tabular-nums hover:text-slate-900 hover:bg-slate-50 rounded-md px-1 py-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600'
          : 'mx-0.5 uppercase text-[11px] font-semibold text-slate-600 tracking-wide hover:text-slate-900 hover:bg-slate-50 rounded-md px-0.5 py-0.5 transition-colors min-w-[46px] text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600'
      }
    >
      {label}
    </button>
    <button
      type="button"
      disabled={disabled}
      onClick={onNext}
      aria-label={kind === 'year' ? 'Año siguiente' : 'Mes siguiente'}
      title={kind === 'year' ? 'Año siguiente' : 'Mes siguiente'}
      className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 transition-colors disabled:opacity-50"
    >
      <ChevronRight size={12} aria-hidden="true" />
    </button>
    {children}
  </div>
);
