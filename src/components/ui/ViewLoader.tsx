/**
 * ViewLoader
 * Loading fallback component for lazy-loaded views
 */
import React from 'react';
import { HospitalSpinner } from './HospitalSpinner';

export const ViewLoader: React.FC = () => (
  <div className="flex items-center justify-center min-h-[400px] py-20">
    <div className="flex flex-col items-center gap-3">
      <HospitalSpinner size={60} />
      <span className="text-slate-500 text-sm font-medium">Cargando módulo...</span>
    </div>
  </div>
);
