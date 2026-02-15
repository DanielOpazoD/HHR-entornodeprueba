import type { DailyRecord } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type {
  DischargeRuntimeActions,
  MoveOrCopyRuntimeActions,
  TransferRuntimeActions,
} from '@/features/census/domain/movements/contracts';
import type {
  RowActionRuntimeActions,
  RowActionRuntimeConfirm,
} from '@/features/census/types/censusRowActionRuntimeTypes';

export interface CensusActionDependenciesData {
  record: DailyRecord | null;
  stabilityRules: StabilityRules;
}

export interface CensusActionDependenciesRuntime {
  clearPatient: RowActionRuntimeActions['clearPatient'];
  moveOrCopyPatient: MoveOrCopyRuntimeActions['moveOrCopyPatient'];
  addDischarge: DischargeRuntimeActions['addDischarge'];
  updateDischarge: DischargeRuntimeActions['updateDischarge'];
  addTransfer: TransferRuntimeActions['addTransfer'];
  updateTransfer: TransferRuntimeActions['updateTransfer'];
  addCMA: RowActionRuntimeActions['addCMA'];
  copyPatientToDate: MoveOrCopyRuntimeActions['copyPatientToDate'];
}

export interface CensusActionDependenciesUi {
  confirm: RowActionRuntimeConfirm['confirm'];
  notifyError: (title: string, message?: string) => void;
}

export interface BuildCensusActionDependenciesParams {
  data: CensusActionDependenciesData;
  runtime: CensusActionDependenciesRuntime;
  ui: CensusActionDependenciesUi;
}

export const buildCensusActionDependencies = ({
  data,
  runtime,
  ui,
}: BuildCensusActionDependenciesParams) => ({
  ...data,
  ...runtime,
  ...ui,
});
