import type { MutableRefObject } from 'react';
import type { DailyRecord } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import { useLatestRef } from '@/hooks/useLatestRef';
import type {
  DischargeRuntimeActions,
  MoveOrCopyRuntimeActions,
  TransferRuntimeActions,
} from '@/features/census/domain/movements/contracts';
import type {
  RowActionRuntimeActions,
  RowActionRuntimeConfirm,
} from '@/features/census/types/censusRowActionRuntimeTypes';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';

export interface UseCensusActionRuntimeRefsParams {
  actionState: ActionState;
  dischargeState: DischargeState;
  transferState: TransferState;
  record: DailyRecord | null;
  stabilityRules: StabilityRules;
  clearPatient: RowActionRuntimeActions['clearPatient'];
  moveOrCopyPatient: MoveOrCopyRuntimeActions['moveOrCopyPatient'];
  addDischarge: DischargeRuntimeActions['addDischarge'];
  updateDischarge: DischargeRuntimeActions['updateDischarge'];
  addTransfer: TransferRuntimeActions['addTransfer'];
  updateTransfer: TransferRuntimeActions['updateTransfer'];
  addCma: RowActionRuntimeActions['addCMA'];
  copyPatientToDate: MoveOrCopyRuntimeActions['copyPatientToDate'];
  confirm: RowActionRuntimeConfirm['confirm'];
  notifyError: (title: string, message?: string) => void;
}

export interface CensusActionRuntimeRefs {
  actionStateRef: MutableRefObject<ActionState>;
  dischargeStateRef: MutableRefObject<DischargeState>;
  transferStateRef: MutableRefObject<TransferState>;
  recordRef: MutableRefObject<DailyRecord | null>;
  stabilityRulesRef: MutableRefObject<StabilityRules>;
  clearPatientRef: MutableRefObject<RowActionRuntimeActions['clearPatient']>;
  moveOrCopyPatientRef: MutableRefObject<MoveOrCopyRuntimeActions['moveOrCopyPatient']>;
  addDischargeRef: MutableRefObject<DischargeRuntimeActions['addDischarge']>;
  updateDischargeRef: MutableRefObject<DischargeRuntimeActions['updateDischarge']>;
  addTransferRef: MutableRefObject<TransferRuntimeActions['addTransfer']>;
  updateTransferRef: MutableRefObject<TransferRuntimeActions['updateTransfer']>;
  addCmaRef: MutableRefObject<RowActionRuntimeActions['addCMA']>;
  copyPatientToDateRef: MutableRefObject<MoveOrCopyRuntimeActions['copyPatientToDate']>;
  confirmRef: MutableRefObject<RowActionRuntimeConfirm['confirm']>;
  notifyErrorRef: MutableRefObject<(title: string, message?: string) => void>;
}

export const useCensusActionRuntimeRefs = ({
  actionState,
  dischargeState,
  transferState,
  record,
  stabilityRules,
  clearPatient,
  moveOrCopyPatient,
  addDischarge,
  updateDischarge,
  addTransfer,
  updateTransfer,
  addCma,
  copyPatientToDate,
  confirm,
  notifyError,
}: UseCensusActionRuntimeRefsParams): CensusActionRuntimeRefs => ({
  actionStateRef: useLatestRef(actionState),
  dischargeStateRef: useLatestRef(dischargeState),
  transferStateRef: useLatestRef(transferState),
  recordRef: useLatestRef(record),
  stabilityRulesRef: useLatestRef(stabilityRules),
  clearPatientRef: useLatestRef(clearPatient),
  moveOrCopyPatientRef: useLatestRef(moveOrCopyPatient),
  addDischargeRef: useLatestRef(addDischarge),
  updateDischargeRef: useLatestRef(updateDischarge),
  addTransferRef: useLatestRef(addTransfer),
  updateTransferRef: useLatestRef(updateTransfer),
  addCmaRef: useLatestRef(addCma),
  copyPatientToDateRef: useLatestRef(copyPatientToDate),
  confirmRef: useLatestRef(confirm),
  notifyErrorRef: useLatestRef(notifyError),
});
