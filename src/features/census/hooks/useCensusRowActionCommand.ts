import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
import { executeRowActionController } from '@/features/census/controllers/censusRowActionRuntimeController';
import { buildRowActionRuntimeActions } from '@/features/census/controllers/censusRowActionRuntimeAdapterController';
import {
  buildRowActionBlockedNotification,
  buildRowActionUnexpectedNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';

interface UseCensusRowActionCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'recordRef' | 'stabilityRulesRef' | 'clearPatientRef' | 'addCmaRef' | 'confirmRef'
> {
  setActionState: Dispatch<SetStateAction<ActionState>>;
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  setTransferState: Dispatch<SetStateAction<TransferState>>;
  notifyError: (notification: CensusActionNotification) => void;
}

export const useCensusRowActionCommand = ({
  stabilityRulesRef,
  recordRef,
  clearPatientRef,
  addCmaRef,
  confirmRef,
  setActionState,
  setDischargeState,
  setTransferState,
  notifyError,
}: UseCensusRowActionCommandParams) =>
  useCallback(
    async (action: PatientRowAction, bedId: string, patient: PatientData) => {
      try {
        const confirmedLastUpdated = recordRef.current?.lastUpdated;
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
          confirmedLastUpdated,
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
      recordRef,
      setActionState,
      setDischargeState,
      setTransferState,
      stabilityRulesRef,
    ]
  );
