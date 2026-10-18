import React from 'react';

/** Neutral loading state: no decoration and no inference that the day is empty. */
export const CensusLoadingState: React.FC = () => (
  <div
    className="flex justify-center py-6 text-xs text-slate-500 print:hidden"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="census-loading-state"
  >
    Cargando
  </div>
);
