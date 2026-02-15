import type { CensusActionDependencies } from '@/features/census/hooks/useCensusActionDependencies';
import type { UseCensusActionRuntimeRefsParams } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import type { CensusActionStateStore } from '@/features/census/hooks/useCensusActionStateStore';

type CensusActionRuntimeRefState = Pick<
  CensusActionStateStore,
  'actionState' | 'dischargeState' | 'transferState'
>;

interface BuildCensusActionRuntimeRefsParams {
  state: CensusActionRuntimeRefState;
  dependencies: CensusActionDependencies;
}

export const buildCensusActionRuntimeRefsParams = ({
  state,
  dependencies,
}: BuildCensusActionRuntimeRefsParams): UseCensusActionRuntimeRefsParams => ({
  actionState: state.actionState,
  dischargeState: state.dischargeState,
  transferState: state.transferState,
  record: dependencies.record,
  stabilityRules: dependencies.stabilityRules,
  clearPatient: dependencies.clearPatient,
  moveOrCopyPatient: dependencies.moveOrCopyPatient,
  addDischarge: dependencies.addDischarge,
  updateDischarge: dependencies.updateDischarge,
  addTransfer: dependencies.addTransfer,
  updateTransfer: dependencies.updateTransfer,
  addCma: dependencies.addCMA,
  copyPatientToDate: dependencies.copyPatientToDate,
  confirm: dependencies.confirm,
  notifyError: dependencies.notifyError,
});
