import React from 'react';
import { History } from 'lucide-react';

interface PatientActionMenuHistoryActionProps {
  onViewHistory: () => void;
}

export const PatientActionMenuHistoryAction: React.FC<PatientActionMenuHistoryActionProps> = ({
  onViewHistory,
}) => (
  <button
    type="button"
    onClick={onViewHistory}
    className="flex min-h-10 w-full items-center gap-2.5 border-b border-slate-100 px-3.5 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50 focus-visible:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-600"
  >
    <History size={15} className="shrink-0 text-teal-600" aria-hidden="true" />
    <span className="font-medium text-[13px]">Ver Historial</span>
  </button>
);
