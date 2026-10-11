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
    className="relative flex h-[30px] items-center shrink-0 rounded-lg bg-slate-50 border border-slate-200/80 px-0 py-0.5"
    ref={containerRef}
  >
    <button
      disabled={disabled}
      onClick={onPrevious}
      className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white transition-colors"
    >
      <ChevronLeft size={12} />
    </button>
    <button
      disabled={disabled}
      onClick={onToggle}
      className={
        kind === 'year'
          ? 'mx-0.5 text-[11px] font-semibold text-slate-600 tabular-nums hover:text-slate-900 hover:bg-white rounded px-1 py-0.5 transition-colors'
          : 'mx-0.5 uppercase text-[11px] font-semibold text-slate-600 tracking-wide hover:text-slate-900 hover:bg-white rounded px-0.5 py-0.5 transition-colors min-w-[46px] text-center'
      }
    >
      {label}
    </button>
    <button
      disabled={disabled}
      onClick={onNext}
      className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white transition-colors"
    >
      <ChevronRight size={12} />
    </button>
    {children}
  </div>
);
