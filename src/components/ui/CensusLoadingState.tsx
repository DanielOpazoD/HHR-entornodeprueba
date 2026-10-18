import React from 'react';
import './censusLoading.css';

/** Manu tara in flight: a single larger silhouette rotating around its vertical axis. */
export const CensusLoadingState: React.FC = () => (
  <div
    className="flex flex-col items-center justify-center gap-2 py-6 text-medical-600 print:hidden"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="census-loading-state"
  >
    <svg viewBox="0 0 96 72" className="census-manutara h-16 w-20" aria-hidden="true">
      <path d="M45 38C33 17 18 9 3 13c12 7 20 17 28 30l13 2Z" fill="currentColor" opacity=".75" />
      <path d="M51 38C63 17 78 9 93 13 81 20 73 30 65 43l-13 2Z" fill="currentColor" />
      <path d="M44 31q-2-10 5-12 7-1 8 6l9 3-10 2-3 12 7 24-12-8-13 8 8-23Z" fill="currentColor" />
      <path d="M48 23q4-2 5 2l-5 1Z" fill="white" opacity=".8" />
      <path
        d="M16 19q15 8 23 21m41-21Q65 27 57 40"
        fill="none"
        stroke="white"
        strokeWidth="1.3"
        opacity=".5"
        strokeLinecap="round"
      />
    </svg>
    <span className="text-xs text-slate-500">Cargando</span>
  </div>
);
