import React from 'react';
import { Ban, History } from 'lucide-react';
import { PatientRowMenuPortal } from './PatientRowMenuPortal';

import type { PatientActionMenuBinding } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { resolvePatientActionMenuPanelModel } from '@/features/census/controllers/patientActionMenuPanelController';
import { PatientActionMenuClinicalSection } from '@/features/census/components/patient-row/PatientActionMenuClinicalSection';

interface PatientActionMenuUtilityGridProps {
  utilityActions: UtilityActionConfig[];
  onAction: (action: PatientRowAction) => void;
}

const PatientActionMenuUtilityGrid: React.FC<PatientActionMenuUtilityGridProps> = ({
  utilityActions,
  onAction,
}) => (
  <div className="grid grid-cols-3 gap-1.5 px-3 py-2 border-b border-slate-100 bg-white">
    {utilityActions.map(({ action, icon: Icon, label, title, iconClassName }) => (
      <button
        role="menuitem"
        key={action}
        type="button"
        onClick={() => onAction(action)}
        className={`flex min-h-8 min-w-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${iconClassName}`}
        title={title}
      >
        <Icon size={13} className="shrink-0" aria-hidden="true" />
        <span className="truncate text-[11px] font-medium leading-none">{label}</span>
      </button>
    ))}
  </div>
);

interface PatientActionMenuHistoryActionProps {
  onViewHistory: () => void;
}

const PatientActionMenuHistoryAction: React.FC<PatientActionMenuHistoryActionProps> = ({
  onViewHistory,
}) => (
  <button
    role="menuitem"
    type="button"
    onClick={onViewHistory}
    className="flex min-h-10 w-full items-center gap-2.5 border-b border-slate-100 px-3.5 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50 focus-visible:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-700"
  >
    <History size={15} className="shrink-0 text-teal-600" aria-hidden="true" />
    <span className="font-medium text-[13px]">Ver Historial</span>
  </button>
);

interface PatientActionMenuPanelProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  binding: PatientActionMenuBinding;
  utilityActions: UtilityActionConfig[];
  onClose: () => void;
  onAction: (action: PatientRowAction) => void;
  onViewHistory: () => void;
  allowedActions?: readonly PatientRowAction[];
  canMarkInvalid?: boolean;
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
  canMarkInvalid = false,
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
  // Whoever may clear the bed may also remove an episode created by mistake.
  const showInvalidAction =
    canMarkInvalid &&
    model.showUtilityActions &&
    model.utilityActions.some(action => action.action === 'clear');

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

        {showInvalidAction && (
          <button
            role="menuitem"
            type="button"
            onClick={() => onAction('invalid')}
            title="Ingreso creado por error: se elimina del censo y la sincronización no lo vuelve a traer"
            className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-[12px] font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-red-700"
          >
            <Ban size={13} aria-hidden="true" />
            Paciente no válido
          </button>
        )}
      </div>
    </PatientRowMenuPortal>
  );
};
