import type { Dispatch, SetStateAction } from 'react';

import { applyDischargePatch } from '@/features/census/controllers/censusModalStateController';
import { executeDischargeController } from '@/features/census/controllers/censusActionRuntimeController';
import {
  buildDischargeErrorNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useCensusModalCommand } from '@/features/census/hooks/useCensusModalCommand';
import type { DischargeExecutionInput } from '@/features/census/domain/movements/contracts';
import type { DischargeState } from '@/domain/censusActionContracts';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';

interface UseCensusDischargeCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'dischargeStateRef' | 'recordRef' | 'stabilityRulesRef' | 'addDischargeRef' | 'updateDischargeRef'
> {
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  getCurrentTime: () => string;
  notifyError: (notification: CensusActionNotification) => void;
}

export const useCensusDischargeCommand = ({
  dischargeStateRef,
  recordRef,
  stabilityRulesRef,
  addDischargeRef,
  updateDischargeRef,
  setDischargeState,
  getCurrentTime,
  notifyError,
}: UseCensusDischargeCommandParams) =>
  useCensusModalCommand<DischargeExecutionInput>(async data => {
    const recordDischargeCriticalAction = (
      outcome: 'success' | 'failed',
      issues?: string[],
      context?: Record<string, unknown>
    ) => {
      const bedId = dischargeStateRef.current.bedId;
      recordCriticalClinicalAction({
        category: 'daily_record',
        action: 'census_discharge_created',
        outcome,
        clinicalDate: recordRef.current?.date,
        bedId: bedId ?? undefined,
        patientRut: bedId ? recordRef.current?.beds?.[bedId]?.rut : undefined,
        issues,
        context,
      });
    };

    const result = executeDischargeController({
      dischargeState: dischargeStateRef.current,
      data,
      stabilityRules: stabilityRulesRef.current,
      nowTime: getCurrentTime(),
      actions: {
        addDischarge: addDischargeRef.current,
        updateDischarge: updateDischargeRef.current,
      },
    });

    if (!result.ok) {
      recordDischargeCriticalAction('failed', [result.error.message], {
        errorCode: result.error.code,
      });
      notifyError(buildDischargeErrorNotification(result.error.code, result.error.message));
      return;
    }

    recordDischargeCriticalAction('success');
    setDischargeState(prev => applyDischargePatch(prev, result.value.closeModalPatch));
  });
