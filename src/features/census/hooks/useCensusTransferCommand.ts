import type { Dispatch, SetStateAction } from 'react';

import {
  RECEIVING_CENTER_EXTRASYSTEM,
  RECEIVING_CENTER_OTHER,
} from '@/constants/clinicalMovementConstants';
import { applyTransferPatch } from '@/features/census/controllers/censusModalStateController';
import { executeTransferController } from '@/features/census/controllers/censusActionRuntimeController';
import {
  buildTransferErrorNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useCensusModalCommand } from '@/features/census/hooks/useCensusModalCommand';
import type { TransferExecutionInput } from '@/features/census/domain/movements/contracts';
import type { TransferState } from '@/domain/censusActionContracts';
import { useAuth } from '@/context/AuthContext';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';

const resolveTransferDestinationHospital = (
  receivingCenter: string,
  receivingCenterOther: string
): string => {
  const otherValue = receivingCenterOther.trim();
  if (
    receivingCenter === RECEIVING_CENTER_OTHER ||
    receivingCenter === RECEIVING_CENTER_EXTRASYSTEM
  ) {
    return otherValue || receivingCenter;
  }
  return receivingCenter;
};

interface UseCensusTransferCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'transferStateRef' | 'stabilityRulesRef' | 'addTransferRef' | 'updateTransferRef' | 'recordRef'
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
  recordRef,
  setTransferState,
  getCurrentTime,
  notifyError,
}: UseCensusTransferCommandParams) => {
  const { currentUser } = useAuth();
  const createdByEmail = currentUser?.email ?? 'census-auto@local';

  return useCensusModalCommand<TransferExecutionInput>(async data => {
    const transferState = transferStateRef.current;
    const record = recordRef.current;
    const bedId = transferState.bedId;
    const patient = bedId ? record?.beds?.[bedId] : undefined;
    const destinationHospital = resolveTransferDestinationHospital(
      transferState.receivingCenter,
      transferState.receivingCenterOther
    );
    const recordTransferCriticalAction = (
      outcome: 'success' | 'failed',
      issues?: string[],
      context?: Record<string, unknown>
    ) => {
      recordCriticalClinicalAction({
        category: 'daily_record',
        action: 'census_transfer_created',
        outcome,
        clinicalDate: record?.date,
        bedId: bedId ?? undefined,
        patientRut: patient?.rut,
        userId: createdByEmail,
        issues,
        context,
      });
    };

    const result = executeTransferController({
      transferState,
      data,
      stabilityRules: stabilityRulesRef.current,
      nowTime: getCurrentTime(),
      actions: {
        addTransfer: addTransferRef.current,
        updateTransfer: updateTransferRef.current,
      },
    });

    if (!result.ok) {
      recordTransferCriticalAction('failed', [result.error.message], {
        errorCode: result.error.code,
      });
      notifyError(buildTransferErrorNotification(result.error.code, result.error.message));
      return;
    }

    recordTransferCriticalAction('success', undefined, {
      destinationHospital,
      linkedTransferRequestId: transferState.recordId,
    });
    setTransferState(prev => applyTransferPatch(prev, result.value.closeModalPatch));
  });
};
