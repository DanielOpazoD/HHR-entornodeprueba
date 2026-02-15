import React from 'react';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface PatientActionMenuUtilityGridProps {
  utilityActions: UtilityActionConfig[];
  onAction: (action: PatientRowAction) => void;
}

export const PatientActionMenuUtilityGrid: React.FC<PatientActionMenuUtilityGridProps> = ({
  utilityActions,
  onAction,
}) => (
  <div className="grid grid-cols-3 gap-1 p-2 bg-slate-50 border-b border-slate-100">
    {utilityActions.map(({ action, icon: Icon, label, title, iconClassName }) => (
      <button
        key={action}
        onClick={() => onAction(action)}
        className={`flex flex-col items-center justify-center p-2 rounded hover:bg-white hover:shadow-sm text-slate-500 transition-all group ${iconClassName}`}
        title={title}
      >
        <Icon size={18} className="mb-1 group-hover:scale-110 transition-transform" />
        <span className="text-[10px] font-medium">{label}</span>
      </button>
    ))}
  </div>
);
