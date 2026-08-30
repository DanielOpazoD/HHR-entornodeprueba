import React from 'react';
import clsx from 'clsx';

import type { PatientActionMenuBinding } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import { resolvePatientActionMenuPanelClassName } from '@/features/census/controllers/patientActionMenuViewController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { resolvePatientActionMenuPanelModel } from '@/features/census/controllers/patientActionMenuPanelController';
import { PatientActionMenuUtilityGrid } from '@/features/census/components/patient-row/PatientActionMenuUtilityGrid';
import { PatientActionMenuHistoryAction } from '@/features/census/components/patient-row/PatientActionMenuHistoryAction';
import { PatientActionMenuClinicalSection } from '@/features/census/components/patient-row/PatientActionMenuClinicalSection';

interface PatientActionMenuPanelProps {
  isOpen: boolean;
  binding: PatientActionMenuBinding;
  utilityActions: UtilityActionConfig[];
  onClose: () => void;
  onAction: (action: PatientRowAction) => void;
  onViewHistory: () => void;
  allowedActions?: readonly PatientRowAction[];
}

export const PatientActionMenuPanel: React.FC<PatientActionMenuPanelProps> = ({
  isOpen,
  binding,
  utilityActions,
  onClose,
  onAction,
  onViewHistory,
  allowedActions,
}) => {
  if (!isOpen) {
    return null;
  }

  const model = resolvePatientActionMenuPanelModel({
    viewState: binding.availability,
    utilityActions,
    showCmaAction: binding.showCmaAction,
    allowedActions,
  });

  if (!model.shouldRender) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}></div>
      <div
        className={clsx(
          'absolute left-10 z-50 bg-white shadow-xl rounded-2xl border border-slate-200/90 w-60 text-left overflow-hidden animate-fade-in print:hidden',
          resolvePatientActionMenuPanelClassName(binding.align)
        )}
      >
        {model.showHistoryAction && (
          <PatientActionMenuHistoryAction onViewHistory={onViewHistory} />
        )}

        {model.showUtilityActions && (
          <PatientActionMenuUtilityGrid utilityActions={model.utilityActions} onAction={onAction} />
        )}

        {model.clinicalActions.length > 0 && (
          <PatientActionMenuClinicalSection
            clinicalActions={model.clinicalActions}
            onAction={onAction}
          />
        )}
      </div>
    </>
  );
};
