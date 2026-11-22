import { useStaffContext } from '@/context/StaffContext';
import { useDailyRecordStaff } from '@/context/DailyRecordContext';
import { useCensusActions } from '@/features/census/context/censusActionContexts';
import { useCensusActionModalProps } from '@/features/census/hooks/useCensusActionModalProps';
import { useCensusModalBindings } from '@/features/census/hooks/useCensusModalBindings';
import { useCensusModalsHandlers } from '@/features/census/hooks/useCensusModalsHandlers';

export const useCensusModalsModel = () => {
  const staffContext = useStaffContext();
  const staff = useDailyRecordStaff();
  const {
    actionState,
    setActionState,
    dischargeState,
    setDischargeState,
    transferState,
    setTransferState,
    executeMoveOrCopy,
    executeDischarge,
    executeTransfer,
  } = useCensusActions();

  const modalBindings = useCensusModalBindings({ actionState, dischargeState, transferState });
  const modalHandlers = useCensusModalsHandlers({
    setActionState,
    setDischargeState,
    setTransferState,
  });
  const actionModalProps = useCensusActionModalProps({
    modalBindings,
    modalHandlers,
    recordDate: staff?.date || '',
    actionCommands: {
      executeMoveOrCopy,
      executeDischarge,
      executeTransfer,
    },
  });

  return {
    staffContext,
    actionModalProps,
  };
};
