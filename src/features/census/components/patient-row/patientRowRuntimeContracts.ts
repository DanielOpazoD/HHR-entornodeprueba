import type { PatientData } from '@/types/domain/patient';

import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { PatientRowDerivedState } from '@/features/census/controllers/patientRowStateController';
import type {
  PatientMainRowViewProps,
  PatientRowModalsProps,
  PatientSubRowViewProps,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientRowBedConfigActions } from '@/features/census/components/patient-row/usePatientRowBedConfigActions';
import type { BuildPatientRowChangeHandlersResult } from '@/features/census/controllers/patientRowChangeHandlersController';
import type { PatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';

export interface PatientRowBedTypeToggleHandlers {
  readonly onToggleBedType: () => void;
  readonly onUpdateClinicalCrib: (action: 'remove') => void;
}

export interface PatientRowModalSavers {
  readonly onSaveDemographics: (fields: Partial<PatientData>) => void;
  readonly onSaveCribDemographics: (fields: Partial<PatientData>) => void;
  readonly onRevertEmptyDemographics: () => void;
}

export interface PatientRowRuntime {
  readonly bedTypeToggles: PatientRowBedTypeToggleHandlers;
  readonly rowState: PatientRowDerivedState;
  readonly uiState: PatientRowUiState;
  readonly handlers: BuildPatientRowChangeHandlersResult;
  readonly modalSavers: PatientRowModalSavers;
  readonly bedConfigActions: PatientRowBedConfigActions;
  readonly handleAction: (action: PatientRowAction) => void;
}

export interface PatientRowBindings {
  readonly mainRowProps: PatientMainRowViewProps;
  readonly subRowProps: PatientSubRowViewProps;
  readonly modalsProps: PatientRowModalsProps;
}

export type PatientMainRowBindings = PatientMainRowViewProps;
export type PatientSubRowBindings = PatientSubRowViewProps;
export type PatientRowModalsBindings = PatientRowModalsProps;
