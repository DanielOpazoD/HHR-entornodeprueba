import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { BedDefinition, BedType, PatientData } from '@/types';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowContracts';
import type {
  PatientMainRowBindings,
  PatientSubRowBindings,
  PatientRowModalsBindings,
  PatientRowBindings,
  PatientRowRuntime,
} from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import { buildPatientMainRowViewState } from '@/features/census/controllers/patientRowMainViewController';

export interface BuildPatientRowBindingsParams {
  bed: BedDefinition;
  bedType: BedType;
  data: PatientData;
  currentDateString: string;
  readOnly: boolean;
  actionMenuAlign: RowMenuAlign;
  diagnosisMode: DiagnosisMode;
  isSubRow: boolean;
  style?: React.CSSProperties;
  runtime: PatientRowRuntime;
}

export type PatientRowBindingsInput = Omit<BuildPatientRowBindingsParams, 'runtime'>;

export const buildPatientMainRowBindings = ({
  bed,
  bedType,
  data,
  currentDateString,
  readOnly,
  actionMenuAlign,
  diagnosisMode,
  style,
  runtime,
}: Pick<
  BuildPatientRowBindingsParams,
  | 'bed'
  | 'bedType'
  | 'data'
  | 'currentDateString'
  | 'readOnly'
  | 'actionMenuAlign'
  | 'diagnosisMode'
  | 'style'
  | 'runtime'
>): PatientMainRowBindings => {
  const mainRowViewState = buildPatientMainRowViewState({
    bedId: bed.id,
    readOnly,
    isEmpty: runtime.rowState.isEmpty,
    isBlocked: runtime.rowState.isBlocked,
    patientName: data.patientName,
    rut: data.rut,
  });

  return {
    bed,
    bedType,
    data,
    currentDateString,
    style,
    readOnly,
    actionMenuAlign,
    diagnosisMode,
    isBlocked: runtime.rowState.isBlocked,
    isEmpty: runtime.rowState.isEmpty,
    hasCompanion: runtime.rowState.hasCompanion,
    hasClinicalCrib: runtime.rowState.hasClinicalCrib,
    isCunaMode: runtime.rowState.isCunaMode,
    mainRowViewState,
    onAction: runtime.handleAction,
    onOpenDemographics: runtime.uiState.openDemographics,
    onOpenExamRequest: runtime.uiState.openExamRequest,
    onOpenHistory: runtime.uiState.openHistory,
    onToggleMode: runtime.bedConfigActions.toggleBedMode,
    onToggleCompanion: runtime.bedConfigActions.toggleCompanionCrib,
    onToggleClinicalCrib: runtime.bedConfigActions.toggleClinicalCrib,
    onToggleBedType: runtime.bedTypeToggles.onToggleBedType,
    onUpdateClinicalCrib: runtime.bedTypeToggles.onUpdateClinicalCrib,
    onChange: runtime.handlers.mainInputChangeHandlers,
  };
};

export const buildPatientSubRowBindings = ({
  data,
  currentDateString,
  readOnly,
  style,
  runtime,
}: Pick<
  BuildPatientRowBindingsParams,
  'data' | 'currentDateString' | 'readOnly' | 'style' | 'runtime'
>): PatientSubRowBindings => ({
  data,
  currentDateString,
  readOnly,
  style,
  onOpenDemographics: runtime.uiState.openDemographics,
  onChange: runtime.handlers.cribInputChangeHandlers,
});

export const buildPatientRowModalsBindings = ({
  bed,
  data,
  currentDateString,
  isSubRow,
  runtime,
}: Pick<
  BuildPatientRowBindingsParams,
  'bed' | 'data' | 'currentDateString' | 'isSubRow' | 'runtime'
>): PatientRowModalsBindings => ({
  bedId: bed.id,
  data,
  currentDateString,
  isSubRow,
  showDemographics: runtime.uiState.showDemographics,
  showExamRequest: runtime.uiState.showExamRequest,
  showHistory: runtime.uiState.showHistory,
  onCloseDemographics: runtime.uiState.closeDemographics,
  onCloseExamRequest: runtime.uiState.closeExamRequest,
  onCloseHistory: runtime.uiState.closeHistory,
  onSaveDemographics: runtime.modalSavers.onSaveDemographics,
  onSaveCribDemographics: runtime.modalSavers.onSaveCribDemographics,
});

export const buildPatientRowBindings = ({
  bed,
  bedType,
  data,
  currentDateString,
  readOnly,
  actionMenuAlign,
  diagnosisMode,
  isSubRow,
  style,
  runtime,
}: BuildPatientRowBindingsParams): PatientRowBindings => {
  return {
    mainRowProps: buildPatientMainRowBindings({
      bed,
      bedType,
      data,
      currentDateString,
      readOnly,
      actionMenuAlign,
      diagnosisMode,
      style,
      runtime,
    }),
    subRowProps: buildPatientSubRowBindings({
      data,
      currentDateString,
      readOnly,
      style,
      runtime,
    }),
    modalsProps: buildPatientRowModalsBindings({
      bed,
      data,
      currentDateString,
      isSubRow,
      runtime,
    }),
  };
};
