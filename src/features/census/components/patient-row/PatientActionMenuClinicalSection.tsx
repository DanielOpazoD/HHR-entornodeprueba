import React from 'react';
import { FileText } from 'lucide-react';
import type { ClinicalActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface PatientActionMenuClinicalSectionProps {
  clinicalActions: readonly ClinicalActionConfig[];
  showExamRequestAction: boolean;
  onAction: (action: PatientRowAction) => void;
  onViewExamRequest: () => void;
}

export const PatientActionMenuClinicalSection: React.FC<PatientActionMenuClinicalSectionProps> = ({
  clinicalActions,
  showExamRequestAction,
  onAction,
  onViewExamRequest,
}) => (
  <div className="py-1">
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 block">
      Gestión Clínica
    </span>
    {clinicalActions.map(({ action, icon: Icon, label, iconClassName }) => (
      <button
        key={action}
        onClick={() => onAction(action)}
        className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-slate-700 group"
      >
        <Icon
          size={16}
          className={`${iconClassName} group-hover:translate-x-0.5 transition-transform`}
        />
        <span className="text-sm">{label}</span>
      </button>
    ))}
    {showExamRequestAction && (
      <>
        <div className="h-px bg-slate-100 mx-3 my-1"></div>
        <button
          onClick={onViewExamRequest}
          className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-slate-700 group"
        >
          <FileText
            size={16}
            className="text-slate-400 group-hover:text-medical-600 transition-colors"
          />
          <span className="text-sm">Solicitud Exámenes</span>
        </button>
      </>
    )}
  </div>
);
