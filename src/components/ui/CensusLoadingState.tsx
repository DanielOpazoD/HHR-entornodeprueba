import React from 'react';
import './censusLoading.css';

/** Small loading row under the application bars; no empty-day UI until confirmed. */
export const CensusLoadingState: React.FC = () => (
  <div
    className="flex items-center justify-center gap-2 py-6 text-medical-600 print:hidden"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="census-loading-state"
  >
    <svg
      viewBox="0 0 64 64"
      className="census-manutara h-5 w-5"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M31 31C23 19 13 15 4 17c9 3 16 9 22 17l-7 11 12-6 12 6-7-12c7-8 15-13 24-15-11-3-20 3-27 11l-1-6 4-3-6 1-2 4Z" />
    </svg>
    <span className="text-xs text-slate-500">Cargando</span>
  </div>
);
