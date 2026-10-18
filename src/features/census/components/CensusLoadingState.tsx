import React from 'react';
import './censusMotion.css';

/** Small, decorative manu tara. Loading is driven by repository state, never a timer. */
export const CensusLoadingState: React.FC<{ message?: string; stalled?: boolean }> = ({
  message = 'Cargando censo…',
  stalled = false,
}) => (
  <div
    className="flex min-h-48 flex-col items-center justify-center gap-3 text-medical-600 print:hidden"
    role="status"
    aria-live="polite"
    aria-busy={!stalled}
    data-testid="census-loading-state"
  >
    <svg
      viewBox="0 0 64 64"
      className={`h-9 w-9 ${stalled ? '' : 'census-manutara'}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M31 31C23 19 13 15 4 17c9 3 16 9 22 17l-7 11 12-6 12 6-7-12c7-8 15-13 24-15-11-3-20 3-27 11l-1-6 4-3-6 1-2 4Z" />
    </svg>
    <span className="max-w-xs text-center text-xs text-slate-500">{message}</span>
  </div>
);
