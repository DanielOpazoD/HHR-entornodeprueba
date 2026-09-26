import React from 'react';
import { FileText } from 'lucide-react';

export const CensusMovementEpicrisisButton: React.FC<{
  patientName: string;
  onClick: () => void;
}> = ({ patientName, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Ver epicrisis de ${patientName}`}
    title="Consultar epicrisis en Eloísa"
    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
  >
    <FileText size={14} aria-hidden="true" />
    Epicrisis
  </button>
);
