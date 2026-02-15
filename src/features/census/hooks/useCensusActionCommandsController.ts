import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import {
  executeDischargeController,
  executeMoveOrCopyController,
  executeTransferController,
} from '@/features/census/controllers/censusActionRuntimeController';
import { executeRowActionController } from '@/features/census/controllers/censusRowActionRuntimeController';
import {
  buildDischargeRuntimeActions,
  buildMoveOrCopyRuntimeActions,
  buildTransferRuntimeActions,
} from '@/features/census/controllers/censusActionRuntimeAdapterController';
import { buildRowActionRuntimeActions } from '@/features/census/controllers/censusRowActionRuntimeAdapterController';
import {
  applyDischargePatch,
  applyTransferPatch,
} from '@/features/census/controllers/censusModalStateController';
import {
  buildDischargeErrorNotification,
  buildMoveOrCopyErrorNotification,
  buildMoveOrCopyUnexpectedNotification,
  buildRowActionBlockedNotification,
  buildRowActionUnexpectedNotification,
  buildTransferErrorNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type {
  DischargeExecutionInput,
  TransferExecutionInput,
} from '@/features/census/types/patientMovementCommandTypes';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useSingleFlightAsyncCommand } from '@/features/census/hooks/useSingleFlightAsyncCommand';

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
  const { runSingleFlight, isMounted } = useSingleFlightAsyncCommand();
  const notifyError = useCallback(
    ({ title, message }: CensusActionNotification) => {
      notifyErrorRef.current(title, message);
    },
    [notifyErrorRef]
  );

  const handleRowAction = useCallback(
    async (action: PatientRowAction, bedId: string, patient: PatientData) => {
      try {
        const result = await executeRowActionController({
          action,
          bedId,
          patient,
          stabilityRules: stabilityRulesRef.current,
          actions: buildRowActionRuntimeActions({
            clearPatient: clearPatientRef.current,
            addCMA: addCmaRef.current,
            setActionState,
            setDischargeState,
            setTransferState,
          }),
          confirmRuntime: { confirm: confirmRef.current },
        });

        if (!result.ok) {
          notifyError(buildRowActionBlockedNotification(result.error.message));
        }
      } catch {
        notifyError(buildRowActionUnexpectedNotification());
      }
    },
    [
      addCmaRef,
      clearPatientRef,
      confirmRef,
      notifyError,
      setActionState,
      setDischargeState,
      setTransferState,
      stabilityRulesRef,
    ]
  );

  const executeMoveOrCopy = useCallback(
    (targetDate?: string) => {
      const started = runSingleFlight(async () => {
        try {
          const result = await executeMoveOrCopyController({
            actionState: actionStateRef.current,
            record: recordRef.current,
            targetDate,
            actions: buildMoveOrCopyRuntimeActions(
              moveOrCopyPatientRef.current,
              copyPatientToDateRef.current
            ),
          });

          if (!isMounted()) {
            return;
          }

          if (!result.ok) {
            notifyError(buildMoveOrCopyErrorNotification(result.error.code, result.error.message));
            return;
          }

          setActionState(result.value.nextActionState);
        } catch {
          if (!isMounted()) {
            return;
          }

          notifyError(buildMoveOrCopyUnexpectedNotification());
        }
      });

      if (!started) {
        return;
      }
    },
    [
      actionStateRef,
      copyPatientToDateRef,
      isMounted,
      moveOrCopyPatientRef,
      notifyError,
      recordRef,
      runSingleFlight,
      setActionState,
    ]
  );

  const executeDischarge = useCallback(
    (data?: DischargeExecutionInput) => {
      const result = executeDischargeController({
        dischargeState: dischargeStateRef.current,
        data,
        stabilityRules: stabilityRulesRef.current,
        nowTime: getCurrentTime(),
        actions: buildDischargeRuntimeActions(addDischargeRef.current, updateDischargeRef.current),
      });

      if (!result.ok) {
        notifyError(buildDischargeErrorNotification(result.error.code, result.error.message));
        return;
      }

      setDischargeState(prev => applyDischargePatch(prev, result.value.closeModalPatch));
    },
    [
      addDischargeRef,
      dischargeStateRef,
      getCurrentTime,
      notifyError,
      setDischargeState,
      stabilityRulesRef,
      updateDischargeRef,
    ]
  );

  const executeTransfer = useCallback(
    (data?: TransferExecutionInput) => {
      const result = executeTransferController({
        transferState: transferStateRef.current,
        data,
        stabilityRules: stabilityRulesRef.current,
        nowTime: getCurrentTime(),
        actions: buildTransferRuntimeActions(addTransferRef.current, updateTransferRef.current),
      });

      if (!result.ok) {
        notifyError(buildTransferErrorNotification(result.error.code, result.error.message));
        return;
      }

      setTransferState(prev => applyTransferPatch(prev, result.value.closeModalPatch));
    },
    [
      addTransferRef,
      getCurrentTime,
      notifyError,
      setTransferState,
      stabilityRulesRef,
      transferStateRef,
      updateTransferRef,
    ]
  );

  return {
    executeMoveOrCopy,
    executeDischarge,
    executeTransfer,
    handleRowAction,
  };
};
