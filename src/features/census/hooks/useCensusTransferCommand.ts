import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { applyTransferPatch } from '@/features/census/controllers/censusModalStateController';
import { buildTransferRuntimeActions } from '@/features/census/controllers/censusActionRuntimeAdapterController';
import { executeTransferController } from '@/features/census/controllers/censusActionRuntimeController';
import {
  buildTransferErrorNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useSingleFlightAsyncCommand } from '@/features/census/hooks/useSingleFlightAsyncCommand';
import type { TransferExecutionInput } from '@/features/census/domain/movements/contracts';
import type { TransferState } from '@/features/census/types/censusActionTypes';

interface UseCensusTransferCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'transferStateRef' | 'stabilityRulesRef' | 'addTransferRef' | 'updateTransferRef'
> {
  setTransferState: Dispatch<SetStateAction<TransferState>>;
  getCurrentTime: () => string;
  notifyError: (notification: CensusActionNotification) => void;
}

export const useCensusTransferCommand = ({
  transferStateRef,
  stabilityRulesRef,
  addTransferRef,
  updateTransferRef,
  setTransferState,
  getCurrentTime,
  notifyError,
}: UseCensusTransferCommandParams) => {
  const { runSingleFlight: runTransferSingleFlight } = useSingleFlightAsyncCommand();

  return useCallback(
    (data?: TransferExecutionInput) => {
      const started = runTransferSingleFlight(async () => {
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
      });

      if (!started) return;
    },
    [
      addTransferRef,
      getCurrentTime,
      notifyError,
      runTransferSingleFlight,
      setTransferState,
      stabilityRulesRef,
      transferStateRef,
      updateTransferRef,
    ]
  );
};
