import type { PatientData } from '@/types/domain/patient';

import type { BedDefinition } from '@/types/domain/beds';
import type { BedType } from '@/types/domain/beds';

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
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';

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
  actionMenuAlign: RowMenuAlign;
  accessProfile?: CensusAccessProfile;
  style?: React.CSSProperties;
  runtime: PatientRowRuntime;
  capabilities: PatientRowCapabilities;
  indicators: PatientRowResolvedIndicators;
}

export const buildPatientMainSectionBindings = ({
  bed,
  bedType,
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  actionMenuAlign,
  accessProfile,
  style,
  runtime,
  capabilities,
  indicators,
}: BuildMainSectionBindingsParams): PatientMainRowBindings => {
  const mainRowViewState = buildPatientMainRowViewState({
    bedId: bed.id,
    readOnly: readOnly || clinicalEditingDisabled,
    isEmpty: runtime.rowState.isEmpty,
    isBlocked: runtime.rowState.isBlocked,
    capabilities,
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
    actionMenuAlign,
    accessProfile,
    isBlocked: runtime.rowState.isBlocked,
    isEmpty: runtime.rowState.isEmpty,
    hasCompanion: runtime.rowState.hasCompanion,
    hasClinicalCrib: runtime.rowState.hasClinicalCrib,
    isCunaMode: runtime.rowState.isCunaMode,
    indicators,
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
  accessProfile?: CensusAccessProfile;
  style?: React.CSSProperties;
  runtime: PatientRowRuntime;
}

export const buildPatientSubSectionBindings = ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  accessProfile,
  style,
  runtime,
}: BuildSubSectionBindingsParams): PatientSubRowBindings => ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled,
  accessProfile,
  style,
  onOpenDemographics: buildPatientRowModalOpenBindings(runtime).onOpenDemographics,
  onOpenHistory: buildPatientRowModalOpenBindings(runtime).onOpenHistory,
  onRemoveClinicalCrib: runtime.bedConfigActions.removeClinicalCrib,
  onChange: runtime.handlers.cribInputChangeHandlers,
});

interface BuildModalSectionBindingsParams {
  bedId: string;
  data: PatientData;
  currentDateString: string;
  isSubRow: boolean;
  canUseArbitraryAdmissionDate?: boolean;
  runtime: PatientRowRuntime;
  capabilities: PatientRowCapabilities;
}

export const buildPatientModalSectionBindings = ({
  bedId,
  data,
  currentDateString,
  isSubRow,
  canUseArbitraryAdmissionDate = false,
  runtime,
  capabilities,
}: BuildModalSectionBindingsParams): PatientRowModalsBindings => ({
  bedId,
  data,
  currentDateString,
  isSubRow,
  showDemographics: runtime.uiState.showDemographics,
  showClinicalDocuments: runtime.uiState.showClinicalDocuments,
  canOpenClinicalDocuments: capabilities.canOpenClinicalDocuments,
  showExamRequest: runtime.uiState.showExamRequest,
  canOpenExamRequest: capabilities.canOpenExamRequest,
  showImagingRequest: runtime.uiState.showImagingRequest,
  canOpenImagingRequest: capabilities.canOpenImagingRequest,
  showHistory: runtime.uiState.showHistory,
  canOpenHistory: capabilities.canOpenHistory,
  ...buildPatientRowModalCloseBindings(runtime),
  onSaveDemographics: runtime.modalSavers.onSaveDemographics,
  onSaveCribDemographics: runtime.modalSavers.onSaveCribDemographics,
  onRevertEmptyDemographics: runtime.modalSavers.onRevertEmptyDemographics,
  canUseArbitraryAdmissionDate,
});
