import React from 'react';
import type { ClinicalActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface PatientActionMenuClinicalSectionProps {
  clinicalActions: readonly ClinicalActionConfig[];
  onAction: (action: PatientRowAction) => void;
}

export const PatientActionMenuClinicalSection: React.FC<PatientActionMenuClinicalSectionProps> = ({
  clinicalActions,
  onAction,
}) => (
  <div className="p-1.5">
    <span className="block px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      Gestión Clínica
    </span>
    {clinicalActions.map(({ action, icon: Icon, label, iconClassName }) => (
      <button
        key={action}
        type="button"
        onClick={() => onAction(action)}
        className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50 focus-visible:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-600"
      >
        <Icon size={15} className={`${iconClassName} shrink-0`} aria-hidden="true" />
        <span className="text-[13px] font-medium">{label}</span>
      </button>
    ))}
  </div>
);
