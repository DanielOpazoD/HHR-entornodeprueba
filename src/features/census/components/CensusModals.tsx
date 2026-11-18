import React from 'react';
import { StaffManagerModal } from '@/components/modals/StaffManagerModal';
import { BedManagerModal } from '@/components/modals/BedManagerModal';
import { useCensusModalsModel } from '@/features/census/hooks/useCensusModalsModel';
import { MoveCopyModal } from '@/components/modals/actions/MoveCopyModal';
import { DischargeModal } from '@/components/modals/actions/DischargeModal';
import { TransferModal } from '@/components/modals/actions/TransferModal';
import type { CensusActionModalPropsModel } from '@/features/census/hooks/useCensusActionModalProps';

interface CensusActionModalsProps {
  actionModalProps: CensusActionModalPropsModel;
}

const CensusActionModals: React.FC<CensusActionModalsProps> = ({ actionModalProps }) => (
  <>
    <MoveCopyModal {...actionModalProps.moveCopyProps} />
    <DischargeModal {...actionModalProps.dischargeProps} />
    <TransferModal {...actionModalProps.transferProps} />
  </>
);

interface CensusModalsProps {
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
}

export const CensusModals: React.FC<CensusModalsProps> = ({
  showBedManagerModal,
  onCloseBedManagerModal,
}) => {
  const {
    staffContext: {
      nursesList,
      nursesSaved,
      tensList,
      tensSaved,
      showNurseManager,
      setShowNurseManager,
      showTensManager,
      setShowTensManager,
    },
    actionModalProps,
  } = useCensusModalsModel();

  return (
    <>
      <StaffManagerModal
        role="nurse"
        isOpen={showNurseManager}
        onClose={() => setShowNurseManager(false)}
        staffList={nursesList}
        saved={nursesSaved}
      />

      <StaffManagerModal
        role="tens"
        isOpen={showTensManager}
        onClose={() => setShowTensManager(false)}
        staffList={tensList}
        saved={tensSaved}
      />

      <BedManagerModal isOpen={showBedManagerModal} onClose={onCloseBedManagerModal} />
      <CensusActionModals actionModalProps={actionModalProps} />
    </>
  );
};
