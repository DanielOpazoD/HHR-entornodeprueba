import type {
  ClinicalActionConfig,
  UtilityActionConfig,
} from '@/features/census/components/patient-row/patientActionMenuConfig';
import { CLINICAL_ACTIONS } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientActionMenuViewState } from '@/features/census/controllers/patientActionMenuViewController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface ResolvePatientActionMenuPanelModelParams {
  viewState: PatientActionMenuViewState;
  utilityActions: UtilityActionConfig[];
  showCmaAction?: boolean;
  allowedActions?: readonly PatientRowAction[];
}

export interface PatientActionMenuPanelModel {
  shouldRender: boolean;
  showHistoryAction: boolean;
  showUtilityActions: boolean;
  utilityActions: UtilityActionConfig[];
  clinicalActions: readonly ClinicalActionConfig[];
}

export const resolvePatientActionMenuPanelModel = ({
  viewState,
  utilityActions,
  showCmaAction = true,
  allowedActions,
}: ResolvePatientActionMenuPanelModelParams): PatientActionMenuPanelModel => {
  const clinicalActions = viewState.showBuiltInClinicalActions
    ? CLINICAL_ACTIONS.filter(
        action =>
          (action.action !== 'cma' || showCmaAction) &&
          (!allowedActions || allowedActions.includes(action.action))
      )
    : [];

  return {
    shouldRender:
      viewState.showHistoryAction || viewState.showUtilityActions || clinicalActions.length > 0,
    showHistoryAction: viewState.showHistoryAction,
    showUtilityActions: viewState.showUtilityActions,
    utilityActions,
    clinicalActions,
  };
};
