import React from 'react';
import { MoreHorizontal, User } from 'lucide-react';
import { MedicalButton } from '@/components/ui/base/MedicalButton';
import type { PatientActionMenuCallbacks, RowMenuAlign } from './patientRowContracts';
import { usePatientActionMenu } from './usePatientActionMenu';
import { PatientActionMenuPanel } from '@/features/census/components/patient-row/PatientActionMenuPanel';

interface PatientActionMenuProps extends PatientActionMenuCallbacks {
  isBlocked: boolean;
  readOnly?: boolean;
  align?: RowMenuAlign;
}

export const PatientActionMenu: React.FC<PatientActionMenuProps> = ({
  isBlocked,
  onAction,
  onViewDemographics,
  onViewExamRequest,
  onViewHistory,
  readOnly = false,
  align = 'top',
}) => {
  const {
    isOpen,
    menuRef,
    viewState,
    utilityActions,
    toggle,
    close,
    handleAction,
    handleViewHistory,
    handleViewExamRequest,
  } = usePatientActionMenu({
    isBlocked,
    readOnly,
    onAction,
    onViewHistory,
    onViewExamRequest,
  });

  return (
    <div className="flex flex-col items-center gap-1 relative" ref={menuRef}>
      {viewState.showDemographicsAction && (
        <div className="flex items-center gap-0.5">
          <MedicalButton
            onClick={onViewDemographics}
            variant="ghost"
            size="xs"
            className="text-medical-500 hover:text-medical-700"
            title="Datos del Paciente"
            icon={<User size={14} />}
          />
        </div>
      )}
      {viewState.showMenuTrigger && (
        <MedicalButton
          onClick={toggle}
          variant="secondary"
          size="xs"
          className="p-1 rounded-full text-slate-500"
          title="Acciones"
          icon={<MoreHorizontal size={14} />}
        />
      )}

      <PatientActionMenuPanel
        isOpen={isOpen}
        align={align}
        viewState={viewState}
        utilityActions={utilityActions}
        onClose={close}
        onAction={handleAction}
        onViewHistory={handleViewHistory}
        onViewExamRequest={handleViewExamRequest}
      />
    </div>
  );
};
