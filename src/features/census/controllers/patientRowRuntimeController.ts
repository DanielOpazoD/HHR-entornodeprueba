import type { PatientData } from '@/types/domain/patient';

import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { PatientRowBedConfigActions } from '@/features/census/components/patient-row/usePatientRowBedConfigActions';
import type { PatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';
import type {
  PatientRowModalSavers,
  PatientRowRuntime,
} from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import type { PatientRowDerivedState } from '@/features/census/controllers/patientRowStateController';
import type { BuildPatientRowChangeHandlersResult } from '@/features/census/controllers/patientRowChangeHandlersController';

interface BuildPatientRowActionDispatcherParams {
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  bedId: string;
  patient: PatientData;
}

export const buildPatientRowActionDispatcher =
  ({ onAction, bedId, patient }: BuildPatientRowActionDispatcherParams) =>
  (action: PatientRowAction): void =>
    onAction(action, bedId, patient);

interface BuildPatientRowBedTypeTogglesParams {
  bedId: string;
  toggleBedType: (bedId: string) => void;
  updateClinicalCrib: (bedId: string, action: 'remove') => void;
}

export const buildPatientRowBedTypeToggles = ({
  bedId,
  toggleBedType,
  updateClinicalCrib,
}: BuildPatientRowBedTypeTogglesParams): {
  onToggleBedType: () => void;
  onUpdateClinicalCrib: (action: 'remove') => void;
} => ({
  onToggleBedType: () => toggleBedType(bedId),
  onUpdateClinicalCrib: action => updateClinicalCrib(bedId, action),
});

interface BuildPatientRowInteractionRuntimeParams {
  uiState: PatientRowUiState;
  bedConfigActions: PatientRowBedConfigActions;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  bedId: string;
  patient: PatientData;
  toggleBedType: (bedId: string) => void;
  updateClinicalCrib: (bedId: string, action: 'remove') => void;
}

export const buildPatientRowInteractionRuntime = ({
  uiState,
  bedConfigActions,
  onAction,
  bedId,
  patient,
  toggleBedType,
  updateClinicalCrib,
}: BuildPatientRowInteractionRuntimeParams): Pick<
  PatientRowRuntime,
  'uiState' | 'bedConfigActions' | 'handleAction' | 'bedTypeToggles'
> => ({
  uiState,
  bedConfigActions,
  handleAction: buildPatientRowActionDispatcher({ onAction, bedId, patient }),
  bedTypeToggles: buildPatientRowBedTypeToggles({
    bedId,
    toggleBedType,
    updateClinicalCrib,
  }),
});

interface BuildPatientRowRuntimeParams {
  rowState: PatientRowDerivedState;
  interactionRuntime: Pick<
    PatientRowRuntime,
    'uiState' | 'bedConfigActions' | 'handleAction' | 'bedTypeToggles'
  >;
  editingRuntime: {
    handlers: BuildPatientRowChangeHandlersResult;
    modalSavers: PatientRowModalSavers;
  };
}

export const buildPatientRowRuntime = ({
  rowState,
  interactionRuntime,
  editingRuntime,
}: BuildPatientRowRuntimeParams): PatientRowRuntime => ({
  rowState,
  ...interactionRuntime,
  ...editingRuntime,
});
