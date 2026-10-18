import React from 'react';
import './censusLoading.css';

/** Original repository artwork, unchanged; only the presentation rotates. */
export const CensusLoadingState: React.FC = () => (
  <div
    className="flex flex-col items-center justify-center gap-2 py-6 print:hidden"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="census-loading-state"
  >
    <img
      src="/images/rapanui/Manutara.png"
      width="400"
      height="400"
      alt=""
      aria-hidden="true"
      className="census-manutara h-24 w-24 object-contain"
      onError={event => {
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
    <span className="text-xs text-slate-500">Cargando</span>
  </div>
);
