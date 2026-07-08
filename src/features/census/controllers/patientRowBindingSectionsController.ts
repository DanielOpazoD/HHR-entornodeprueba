import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { BedDefinition, BedType } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type {
  PatientMainRowBindings,
  PatientRowModalsBindings,
  PatientSubRowBindings,
  PatientRowRuntime,
} from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import type { PatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';
import type { PatientRowResolvedIndicators } from '@/features/census/controllers/patientRowIndicatorsController';
import { buildPatientMainRowViewState } from '@/features/census/controllers/patientRowMainViewController';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { HydratedRemoteClinicalFieldLocks } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export interface PatientRowViewContext {
  capabilities: PatientRowCapabilities;
  indicators: PatientRowResolvedIndicators;
}

const buildPatientRowModalOpenBindings = (runtime: PatientRowRuntime) => ({
  onOpenDemographics: runtime.uiState.openDemographics,
  onOpenClinicalDocuments: runtime.uiState.openClinicalDocuments,
  onOpenExamRequest: runtime.uiState.openExamRequest,
  onOpenImagingRequest: runtime.uiState.openImagingRequest,
  onOpenHistory: runtime.uiState.openHistory,
});

const buildPatientRowModalCloseBindings = (runtime: PatientRowRuntime) => ({
  onCloseDemographics: runtime.uiState.closeDemographics,
  onCloseClinicalDocuments: runtime.uiState.closeClinicalDocuments,
  onCloseExamRequest: runtime.uiState.closeExamRequest,
  onCloseImagingRequest: runtime.uiState.closeImagingRequest,
  onCloseHistory: runtime.uiState.closeHistory,
});

interface BuildMainSectionBindingsParams {
  bed: BedDefinition;
  bedType: BedType;
  data: PatientData;
  currentDateString: string;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocks?: HydratedRemoteClinicalFieldLocks;
  actionMenuAlign: RowMenuAlign;
  diagnosisMode: DiagnosisMode;
  accessProfile?: CensusAccessProfile;
  style?: React.CSSProperties;
  runtime: PatientRowRuntime;
  viewContext: PatientRowViewContext;
}

export const buildPatientMainSectionBindings = ({
  bed,
  bedType,
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  clinicalFieldLocks,
  actionMenuAlign,
  diagnosisMode,
  accessProfile,
  style,
  runtime,
  viewContext,
}: BuildMainSectionBindingsParams): PatientMainRowBindings => {
  const mainRowViewState = buildPatientMainRowViewState({
    bedId: bed.id,
    readOnly: readOnly || clinicalEditingDisabled,
    isEmpty: runtime.rowState.isEmpty,
    isBlocked: runtime.rowState.isBlocked,
    capabilities: viewContext.capabilities,
    isUpc: data.isUPC,
    patientName: data.patientName,
  });

  return {
    bed,
    bedType,
    data,
    currentDateString,
    style,
    readOnly,
    clinicalEditingDisabled,
    clinicalFieldLocks,
    actionMenuAlign,
    diagnosisMode,
    accessProfile,
    isBlocked: runtime.rowState.isBlocked,
    isEmpty: runtime.rowState.isEmpty,
    hasCompanion: runtime.rowState.hasCompanion,
    hasClinicalCrib: runtime.rowState.hasClinicalCrib,
    isCunaMode: runtime.rowState.isCunaMode,
    indicators: viewContext.indicators,
    mainRowViewState,
    onAction: runtime.handleAction,
    ...buildPatientRowModalOpenBindings(runtime),
    onToggleMode: runtime.bedConfigActions.toggleBedMode,
    onToggleCompanion: runtime.bedConfigActions.toggleCompanionCrib,
    onToggleClinicalCrib: runtime.bedConfigActions.toggleClinicalCrib,
    onToggleBedType: runtime.bedTypeToggles.onToggleBedType,
    onUpdateClinicalCrib: runtime.bedTypeToggles.onUpdateClinicalCrib,
    onChange: runtime.handlers.mainInputChangeHandlers,
  };
};

interface BuildSubSectionBindingsParams {
  data: PatientData;
  currentDateString: string;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocks?: HydratedRemoteClinicalFieldLocks;
  diagnosisMode: DiagnosisMode;
  accessProfile?: CensusAccessProfile;
  style?: React.CSSProperties;
  runtime: PatientRowRuntime;
}

export const buildPatientSubSectionBindings = ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  clinicalFieldLocks,
  diagnosisMode,
  accessProfile,
  style,
  runtime,
}: BuildSubSectionBindingsParams): PatientSubRowBindings => ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  diagnosisMode,
  accessProfile,
  style,
  onOpenDemographics: buildPatientRowModalOpenBindings(runtime).onOpenDemographics,
  onChange: runtime.handlers.cribInputChangeHandlers,
});

interface BuildModalSectionBindingsParams {
  bedId: string;
  data: PatientData;
  currentDateString: string;
  isSubRow: boolean;
  canUseArbitraryAdmissionDate?: boolean;
  runtime: PatientRowRuntime;
  viewContext: PatientRowViewContext;
}

export const buildPatientModalSectionBindings = ({
  bedId,
  data,
  currentDateString,
  isSubRow,
  canUseArbitraryAdmissionDate = false,
  runtime,
  viewContext,
}: BuildModalSectionBindingsParams): PatientRowModalsBindings => ({
  bedId,
  data,
  currentDateString,
  isSubRow,
  showDemographics: runtime.uiState.showDemographics,
  showClinicalDocuments: runtime.uiState.showClinicalDocuments,
  canOpenClinicalDocuments: viewContext.capabilities.canOpenClinicalDocuments,
  showExamRequest: runtime.uiState.showExamRequest,
  canOpenExamRequest: viewContext.capabilities.canOpenExamRequest,
  showImagingRequest: runtime.uiState.showImagingRequest,
  canOpenImagingRequest: viewContext.capabilities.canOpenImagingRequest,
  showHistory: runtime.uiState.showHistory,
  canOpenHistory: viewContext.capabilities.canOpenHistory,
  ...buildPatientRowModalCloseBindings(runtime),
  onSaveDemographics: runtime.modalSavers.onSaveDemographics,
  onSaveCribDemographics: runtime.modalSavers.onSaveCribDemographics,
  onRevertEmptyDemographics: runtime.modalSavers.onRevertEmptyDemographics,
  canUseArbitraryAdmissionDate,
});
