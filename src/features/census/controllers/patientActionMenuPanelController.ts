import type {
  ClinicalActionConfig,
  UtilityActionConfig,
} from '@/features/census/components/patient-row/patientActionMenuConfig';
import { CLINICAL_ACTIONS } from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientActionMenuViewState } from '@/features/census/controllers/patientActionMenuViewController';

interface ResolvePatientActionMenuPanelModelParams {
  viewState: PatientActionMenuViewState;
  utilityActions: UtilityActionConfig[];
}

export interface PatientActionMenuPanelModel {
  showHistoryAction: boolean;
  showClinicalSection: boolean;
  showExamRequestAction: boolean;
  utilityActions: UtilityActionConfig[];
  clinicalActions: readonly ClinicalActionConfig[];
}

export const resolvePatientActionMenuPanelModel = ({
  viewState,
  utilityActions,
}: ResolvePatientActionMenuPanelModelParams): PatientActionMenuPanelModel => ({
  showHistoryAction: viewState.showHistoryAction,
  showClinicalSection: viewState.showClinicalSection,
  showExamRequestAction: viewState.showExamRequestAction,
  utilityActions,
  clinicalActions: CLINICAL_ACTIONS,
});
