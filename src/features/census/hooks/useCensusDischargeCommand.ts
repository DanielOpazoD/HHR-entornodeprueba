import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { applyDischargePatch } from '@/features/census/controllers/censusModalStateController';
import { buildDischargeRuntimeActions } from '@/features/census/controllers/censusActionRuntimeAdapterController';
import { executeDischargeController } from '@/features/census/controllers/censusActionRuntimeController';
import {
  buildDischargeErrorNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useSingleFlightAsyncCommand } from '@/features/census/hooks/useSingleFlightAsyncCommand';
import type { DischargeExecutionInput } from '@/features/census/domain/movements/contracts';
import type { DischargeState } from '@/features/census/types/censusActionTypes';

interface UseCensusDischargeCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'dischargeStateRef' | 'stabilityRulesRef' | 'addDischargeRef' | 'updateDischargeRef'
> {
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  getCurrentTime: () => string;
  notifyError: (notification: CensusActionNotification) => void;
}

export const useCensusDischargeCommand = ({
  dischargeStateRef,
  stabilityRulesRef,
  addDischargeRef,
  updateDischargeRef,
  setDischargeState,
  getCurrentTime,
  notifyError,
}: UseCensusDischargeCommandParams) => {
  const { runSingleFlight: runDischargeSingleFlight } = useSingleFlightAsyncCommand();

  return useCallback(
    (data?: DischargeExecutionInput) => {
      const started = runDischargeSingleFlight(async () => {
        const result = executeDischargeController({
          dischargeState: dischargeStateRef.current,
          data,
          stabilityRules: stabilityRulesRef.current,
          nowTime: getCurrentTime(),
          actions: buildDischargeRuntimeActions(
            addDischargeRef.current,
            updateDischargeRef.current
          ),
        });

        if (!result.ok) {
          notifyError(buildDischargeErrorNotification(result.error.code, result.error.message));
          return;
        }

        setDischargeState(prev => applyDischargePatch(prev, result.value.closeModalPatch));
      });

      if (!started) return;
    },
    [
      addDischargeRef,
      dischargeStateRef,
      getCurrentTime,
      notifyError,
      runDischargeSingleFlight,
      setDischargeState,
      stabilityRulesRef,
      updateDischargeRef,
    ]
  );
};
