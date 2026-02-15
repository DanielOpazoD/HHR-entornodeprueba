import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { executeMoveOrCopyController } from '@/features/census/controllers/censusActionRuntimeController';
import { buildMoveOrCopyRuntimeActions } from '@/features/census/controllers/censusActionRuntimeAdapterController';
import {
  buildMoveOrCopyErrorNotification,
  buildMoveOrCopyUnexpectedNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useSingleFlightAsyncCommand } from '@/features/census/hooks/useSingleFlightAsyncCommand';
import type { ActionState } from '@/features/census/types/censusActionTypes';

interface UseCensusMoveOrCopyCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'actionStateRef' | 'recordRef' | 'moveOrCopyPatientRef' | 'copyPatientToDateRef'
> {
  setActionState: Dispatch<SetStateAction<ActionState>>;
  notifyError: (notification: CensusActionNotification) => void;
}

export const useCensusMoveOrCopyCommand = ({
  actionStateRef,
  recordRef,
  moveOrCopyPatientRef,
  copyPatientToDateRef,
  setActionState,
  notifyError,
}: UseCensusMoveOrCopyCommandParams) => {
  const { runSingleFlight: runMoveOrCopySingleFlight, isMounted } = useSingleFlightAsyncCommand();

  return useCallback(
    (targetDate?: string) => {
      const started = runMoveOrCopySingleFlight(async () => {
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

          if (!isMounted()) return;

          if (!result.ok) {
            notifyError(buildMoveOrCopyErrorNotification(result.error.code, result.error.message));
            return;
          }

          setActionState(result.value.nextActionState);
        } catch {
          if (!isMounted()) return;
          notifyError(buildMoveOrCopyUnexpectedNotification());
        }
      });

      if (!started) return;
    },
    [
      actionStateRef,
      copyPatientToDateRef,
      isMounted,
      moveOrCopyPatientRef,
      notifyError,
      recordRef,
      runMoveOrCopySingleFlight,
      setActionState,
    ]
  );
};
