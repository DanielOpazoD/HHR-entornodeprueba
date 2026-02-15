import React from 'react';
import { FileText, History } from 'lucide-react';
import clsx from 'clsx';

import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowContracts';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import { CLINICAL_ACTIONS } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientActionMenuViewState } from '@/features/census/controllers/patientActionMenuViewController';
import { resolvePatientActionMenuPanelClassName } from '@/features/census/controllers/patientActionMenuViewController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface PatientActionMenuPanelProps {
  isOpen: boolean;
  align: RowMenuAlign;
  viewState: PatientActionMenuViewState;
  utilityActions: UtilityActionConfig[];
  onClose: () => void;
  onAction: (action: PatientRowAction) => void;
  onViewHistory: () => void;
  onViewExamRequest: () => void;
}

export const PatientActionMenuPanel: React.FC<PatientActionMenuPanelProps> = ({
  isOpen,
  align,
  viewState,
  utilityActions,
  onClose,
  onAction,
  onViewHistory,
  onViewExamRequest,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}></div>
      <div
        className={clsx(
          'absolute left-10 z-50 bg-white shadow-xl rounded-xl border border-slate-200 w-64 text-left overflow-hidden animate-fade-in print:hidden',
          resolvePatientActionMenuPanelClassName(align)
        )}
      >
        {viewState.showHistoryAction && (
          <button
            onClick={onViewHistory}
            className="w-full text-left px-4 py-2.5 hover:bg-purple-50 flex items-center gap-3 text-slate-700 border-b border-slate-100"
          >
            <div className="p-1 bg-purple-100 rounded text-purple-600">
              <History size={14} />
            </div>
            <span className="font-medium text-sm">Ver Historial</span>
          </button>
        )}

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

        {viewState.showClinicalSection && (
          <div className="py-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 block">
              Gestión Clínica
            </span>
            {CLINICAL_ACTIONS.map(({ action, icon: Icon, label, iconClassName }) => (
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
            {viewState.showExamRequestAction && (
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
        )}
      </div>
    </>
  );
};
