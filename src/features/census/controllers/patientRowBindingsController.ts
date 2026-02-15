import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { BedDefinition, BedType, PatientData } from '@/types';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientMainRowViewProps } from '@/features/census/components/patient-row/PatientMainRowView';
import type { PatientSubRowViewProps } from '@/features/census/components/patient-row/PatientSubRowView';
import type { PatientRowModalsProps } from '@/features/census/components/patient-row/PatientRowModals';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/usePatientRowRuntime';

interface BuildPatientRowBindingsParams {
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

interface PatientRowBindings {
  mainRowProps: PatientMainRowViewProps;
  subRowProps: PatientSubRowViewProps;
  modalsProps: PatientRowModalsProps;
}

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
}: BuildPatientRowBindingsParams): PatientRowBindings => ({
  mainRowProps: {
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
  },
  subRowProps: {
    data,
    currentDateString,
    readOnly,
    style,
    onOpenDemographics: runtime.uiState.openDemographics,
    onChange: runtime.handlers.cribInputChangeHandlers,
  },
  modalsProps: {
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
  },
});
