import React from 'react';
import clsx from 'clsx';

import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowContracts';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientActionMenuViewState } from '@/features/census/controllers/patientActionMenuViewController';
import { resolvePatientActionMenuPanelClassName } from '@/features/census/controllers/patientActionMenuViewController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { resolvePatientActionMenuPanelModel } from '@/features/census/controllers/patientActionMenuPanelController';
import { PatientActionMenuUtilityGrid } from '@/features/census/components/patient-row/PatientActionMenuUtilityGrid';
import { PatientActionMenuClinicalSection } from '@/features/census/components/patient-row/PatientActionMenuClinicalSection';
import { PatientActionMenuHistoryAction } from '@/features/census/components/patient-row/PatientActionMenuHistoryAction';

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

  const model = resolvePatientActionMenuPanelModel({
    viewState,
    utilityActions,
  });

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}></div>
      <div
        className={clsx(
          'absolute left-10 z-50 bg-white shadow-xl rounded-xl border border-slate-200 w-64 text-left overflow-hidden animate-fade-in print:hidden',
          resolvePatientActionMenuPanelClassName(align)
        )}
      >
        {model.showHistoryAction && (
          <PatientActionMenuHistoryAction onViewHistory={onViewHistory} />
        )}

        <PatientActionMenuUtilityGrid utilityActions={model.utilityActions} onAction={onAction} />

        {model.showClinicalSection && (
          <PatientActionMenuClinicalSection
            clinicalActions={model.clinicalActions}
            showExamRequestAction={model.showExamRequestAction}
            onAction={onAction}
            onViewExamRequest={onViewExamRequest}
          />
        )}
      </div>
    </>
  );
};
