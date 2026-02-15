import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { type CensusActionNotification } from '@/features/census/controllers/censusActionNotificationController';
import type {
  DischargeExecutionInput,
  TransferExecutionInput,
} from '@/features/census/domain/movements/contracts';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useCensusDischargeCommand } from '@/features/census/hooks/useCensusDischargeCommand';
import { useCensusMoveOrCopyCommand } from '@/features/census/hooks/useCensusMoveOrCopyCommand';
import { useCensusRowActionCommand } from '@/features/census/hooks/useCensusRowActionCommand';
import { useCensusTransferCommand } from '@/features/census/hooks/useCensusTransferCommand';

interface UseCensusActionCommandsControllerParams extends CensusActionRuntimeRefs {
  setActionState: Dispatch<SetStateAction<ActionState>>;
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  setTransferState: Dispatch<SetStateAction<TransferState>>;
  getCurrentTime: () => string;
}

export interface CensusActionCommandsController {
  executeMoveOrCopy: (targetDate?: string) => void;
  executeDischarge: (data?: DischargeExecutionInput) => void;
  executeTransfer: (data?: TransferExecutionInput) => void;
  handleRowAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export const useCensusActionCommandsController = ({
  actionStateRef,
  dischargeStateRef,
  transferStateRef,
  recordRef,
  stabilityRulesRef,
  clearPatientRef,
  moveOrCopyPatientRef,
  addDischargeRef,
  updateDischargeRef,
  addTransferRef,
  updateTransferRef,
  addCmaRef,
  copyPatientToDateRef,
  confirmRef,
  notifyErrorRef,
  setActionState,
  setDischargeState,
  setTransferState,
  getCurrentTime,
}: UseCensusActionCommandsControllerParams): CensusActionCommandsController => {
  const notifyError = useCallback(
    ({ title, message }: CensusActionNotification) => {
      notifyErrorRef.current(title, message);
    },
    [notifyErrorRef]
  );

  const handleRowAction = useCensusRowActionCommand({
    stabilityRulesRef,
    clearPatientRef,
    addCmaRef,
    confirmRef,
    setActionState,
    setDischargeState,
    setTransferState,
    notifyError,
  });

  const executeMoveOrCopy = useCensusMoveOrCopyCommand({
    actionStateRef,
    recordRef,
    moveOrCopyPatientRef,
    copyPatientToDateRef,
    setActionState,
    notifyError,
  });

  const executeDischarge = useCensusDischargeCommand({
    dischargeStateRef,
    stabilityRulesRef,
    addDischargeRef,
    updateDischargeRef,
    setDischargeState,
    getCurrentTime,
    notifyError,
  });

  const executeTransfer = useCensusTransferCommand({
    transferStateRef,
    stabilityRulesRef,
    addTransferRef,
    updateTransferRef,
    setTransferState,
    getCurrentTime,
    notifyError,
  });

  return {
    executeMoveOrCopy,
    executeDischarge,
    executeTransfer,
    handleRowAction,
  };
};
