import React from 'react';
import { formatCensusIsoDate } from '@/shared/census/censusPresentation';

interface CensusPrintHeaderProps {
  currentDateString: string;
}

export const CensusPrintHeader: React.FC<CensusPrintHeaderProps> = ({ currentDateString }) => (
  <div className="hidden print:flex flex-col items-center text-center mb-4 text-slate-900">
    <h1 className="text-2xl font-bold uppercase leading-tight">
      Censo diario de servicios hospitalizados - Hospital Hanga Roa
    </h1>
    <p className="text-sm font-semibold mt-1">Fecha: {formatCensusIsoDate(currentDateString)}</p>
  </div>
);
