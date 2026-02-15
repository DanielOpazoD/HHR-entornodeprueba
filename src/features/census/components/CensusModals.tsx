import React from 'react';
import { useStaffContext } from '@/context/StaffContext';
import { NurseManagerModal } from '@/components/modals/NurseManagerModal';
import { TensManagerModal } from '@/components/modals/TensManagerModal';
import { BedManagerModal } from '@/components/modals/BedManagerModal';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useCensusModalBindings } from '@/features/census/hooks/useCensusModalBindings';
import { useCensusActionModalProps } from '@/features/census/hooks/useCensusActionModalProps';
import { useCensusModalsHandlers } from '@/features/census/hooks/useCensusModalsHandlers';
import { useCensusActionCommands, useCensusActionState } from './CensusActionsContext';
import { CensusActionModals } from './CensusActionModals';

interface CensusModalsProps {
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
}

export const CensusModals: React.FC<CensusModalsProps> = ({
  showBedManagerModal,
  onCloseBedManagerModal,
}) => {
  // Staff management from StaffContext
  const {
    nursesList,
    tensList,
    showNurseManager,
    setShowNurseManager,
    showTensManager,
    setShowTensManager,
  } = useStaffContext();
  const { record } = useDailyRecordData();

  const {
    actionState,
    setActionState,
    dischargeState,
    setDischargeState,
    transferState,
    setTransferState,
  } = useCensusActionState();
  const { executeMoveOrCopy, executeDischarge, executeTransfer } = useCensusActionCommands();
  const modalBindings = useCensusModalBindings({ actionState, dischargeState, transferState });
  const modalHandlers = useCensusModalsHandlers({
    setActionState,
    setDischargeState,
    setTransferState,
  });
  const actionModalProps = useCensusActionModalProps({
    modalBindings,
    modalHandlers,
    recordDate: record?.date || '',
    actionCommands: {
      executeMoveOrCopy,
      executeDischarge,
      executeTransfer,
    },
  });

  return (
    <>
      <NurseManagerModal
        isOpen={showNurseManager}
        onClose={() => setShowNurseManager(false)}
        nursesList={nursesList}
      />

      <TensManagerModal
        isOpen={showTensManager}
        onClose={() => setShowTensManager(false)}
        tensList={tensList}
      />

      <BedManagerModal isOpen={showBedManagerModal} onClose={onCloseBedManagerModal} />
      <CensusActionModals actionModalProps={actionModalProps} />
    </>
  );
};
