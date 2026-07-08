import React from 'react';
import { FileText } from 'lucide-react';

import { BaseModal } from '@/components/shared/BaseModal';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import { ClinicalDocumentsWorkspace } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';

interface ClinicalDocumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientData;
  currentDateString: string;
  bedId: string;
}

export const ClinicalDocumentsModal: React.FC<ClinicalDocumentsModalProps> = ({
  isOpen,
  onClose,
  patient,
  currentDateString,
  bedId,
}) => {
  const headerActionsId = React.useId();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div>
          <h2 className="text-base font-bold text-slate-800 leading-tight">Documentos Clínicos</h2>
        </div>
      }
      icon={<FileText size={18} className="text-medical-600" />}
      size="full"
      className="max-w-[96vw] max-h-[98vh] xl:max-w-[1500px]"
      variant="white"
      bodyClassName="p-0"
      scrollableBody={false}
      headerActions={
        <div
          id={headerActionsId}
          className="flex min-h-[60px] min-w-0 flex-1 items-center justify-end overflow-x-auto overflow-y-visible sm:justify-center"
        />
      }
    >
      <ClinicalDocumentsWorkspace
        patient={patient}
        currentDateString={currentDateString}
        bedId={bedId}
        isActive={isOpen}
        headerActionsContainerId={headerActionsId}
      />
    </BaseModal>
  );
};

export default ClinicalDocumentsModal;
