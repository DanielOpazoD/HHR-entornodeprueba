import React from 'react';
import { History } from 'lucide-react';

interface PatientActionMenuHistoryActionProps {
  onViewHistory: () => void;
}

export const PatientActionMenuHistoryAction: React.FC<PatientActionMenuHistoryActionProps> = ({
  onViewHistory,
}) => (
  <button
    onClick={onViewHistory}
    className="w-full text-left px-4 py-2.5 hover:bg-purple-50 flex items-center gap-3 text-slate-700 border-b border-slate-100"
  >
    <div className="p-1 bg-purple-100 rounded text-purple-600">
      <History size={14} />
    </div>
    <span className="font-medium text-sm">Ver Historial</span>
  </button>
);
