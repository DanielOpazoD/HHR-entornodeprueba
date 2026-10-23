import React from 'react';
import './censusLoading.css';

/** Decorative dots never imply that the selected day is empty. */
export const CensusLoadingState: React.FC = () => (
  <div
    className="flex justify-center py-6 print:hidden"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="census-loading-state"
  >
    <span className="sr-only">Cargando</span>
    <span className="census-loading-dots" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  </div>
);
