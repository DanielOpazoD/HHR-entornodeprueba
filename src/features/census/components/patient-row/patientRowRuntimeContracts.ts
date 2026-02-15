import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';
import type {
  PatientMainRowViewProps,
  PatientRowModalsProps,
  PatientSubRowViewProps,
} from '@/features/census/components/patient-row/patientRowViewContracts';
import type { usePatientRowBedConfigActions } from '@/features/census/components/patient-row/usePatientRowBedConfigActions';
import type { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';
import type { usePatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';
import type { PatientData } from '@/types';

export interface PatientRowBedTypeToggleHandlers {
  readonly onToggleBedType: () => void;
  readonly onUpdateClinicalCrib: (action: 'remove') => void;
}

export interface PatientRowModalSavers {
  readonly onSaveDemographics: (fields: Partial<PatientData>) => void;
  readonly onSaveCribDemographics: (fields: Partial<PatientData>) => void;
}

export interface PatientRowRuntime {
  readonly bedTypeToggles: PatientRowBedTypeToggleHandlers;
  readonly rowState: ReturnType<typeof derivePatientRowState>;
  readonly uiState: ReturnType<typeof usePatientRowUiState>;
  readonly handlers: ReturnType<typeof usePatientRowChangeHandlers>;
  readonly modalSavers: PatientRowModalSavers;
  readonly bedConfigActions: ReturnType<typeof usePatientRowBedConfigActions>;
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
