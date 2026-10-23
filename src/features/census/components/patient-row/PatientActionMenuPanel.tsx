import React from 'react';
import { PatientRowMenuPortal } from './PatientRowMenuPortal';

import type { PatientActionMenuBinding } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { resolvePatientActionMenuPanelModel } from '@/features/census/controllers/patientActionMenuPanelController';
import { PatientActionMenuUtilityGrid } from '@/features/census/components/patient-row/PatientActionMenuUtilityGrid';
import { PatientActionMenuHistoryAction } from '@/features/census/components/patient-row/PatientActionMenuHistoryAction';
import { PatientActionMenuClinicalSection } from '@/features/census/components/patient-row/PatientActionMenuClinicalSection';

interface PatientActionMenuPanelProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  binding: PatientActionMenuBinding;
  utilityActions: UtilityActionConfig[];
  onClose: () => void;
  onAction: (action: PatientRowAction) => void;
  onViewHistory: () => void;
  allowedActions?: readonly PatientRowAction[];
}

export const PatientActionMenuPanel: React.FC<PatientActionMenuPanelProps> = ({
  anchorRef,
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
    <PatientRowMenuPortal anchorRef={anchorRef} align={binding.align} onClose={onClose}>
      <div className="w-64 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-xl">
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
    </PatientRowMenuPortal>
  );
};
