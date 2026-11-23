import type { PatientData } from '@/types/domain/patient';
import type { PatientRowModalsProps } from '@/features/census/components/patient-row/patientRowContracts';

interface ResolvePatientRowDemographicsBindingParams {
  bedId: string;
  isSubRow: boolean;
  data: PatientData;
  onSaveDemographics: (fields: Partial<PatientData>) => void;
  onSaveCribDemographics: (fields: Partial<PatientData>) => void;
}

export interface PatientRowDemographicsBinding {
  targetBedId: string;
  isRnIdentityContext: boolean;
  onSave: (fields: Partial<PatientData>) => void;
}

export const resolvePatientRowDemographicsBinding = ({
  bedId,
  isSubRow,
  data,
  onSaveDemographics,
  onSaveCribDemographics,
}: ResolvePatientRowDemographicsBindingParams): PatientRowDemographicsBinding => ({
  targetBedId: isSubRow ? `${bedId}-cuna` : bedId,
  isRnIdentityContext: isSubRow || data.bedMode === 'Cuna',
  onSave: isSubRow ? onSaveCribDemographics : onSaveDemographics,
});

interface ResolvePatientRowModalVisibilityParams {
  showDemographics: boolean;
  showClinicalDocuments: boolean;
  canOpenClinicalDocuments: boolean;
  showExamRequest: boolean;
  canOpenExamRequest: boolean;
  showImagingRequest: boolean;
  canOpenImagingRequest: boolean;
  showHistory: boolean;
  canOpenHistory: boolean;
}

export interface PatientRowModalVisibilityState {
  shouldRenderDemographics: boolean;
  shouldRenderClinicalDocuments: boolean;
  shouldRenderExamRequest: boolean;
  shouldRenderImagingRequest: boolean;
  shouldRenderHistory: boolean;
}

export const resolvePatientRowModalVisibilityState = ({
  showDemographics,
  showClinicalDocuments,
  canOpenClinicalDocuments,
  showExamRequest,
  canOpenExamRequest,
  showImagingRequest,
  canOpenImagingRequest,
  showHistory,
  canOpenHistory,
}: ResolvePatientRowModalVisibilityParams): PatientRowModalVisibilityState => ({
  shouldRenderDemographics: showDemographics,
  shouldRenderClinicalDocuments: showClinicalDocuments && canOpenClinicalDocuments,
  shouldRenderExamRequest: showExamRequest && canOpenExamRequest,
  shouldRenderImagingRequest: showImagingRequest && canOpenImagingRequest,
  shouldRenderHistory: showHistory && canOpenHistory,
});

export interface PatientRowModalRenderModel {
  demographicsBinding: ReturnType<typeof resolvePatientRowDemographicsBinding>;
  visibilityState: ReturnType<typeof resolvePatientRowModalVisibilityState>;
  shouldRenderAnyModal: boolean;
  demographicsKey: string;
  historyPatientRut: string;
  historyPatientName: string;
}

type PatientRowModalRenderInput = Pick<
  PatientRowModalsProps,
  | 'bedId'
  | 'data'
  | 'isSubRow'
  | 'showDemographics'
  | 'showClinicalDocuments'
  | 'canOpenClinicalDocuments'
  | 'showExamRequest'
  | 'canOpenExamRequest'
  | 'showImagingRequest'
  | 'canOpenImagingRequest'
  | 'showHistory'
  | 'canOpenHistory'
  | 'onSaveDemographics'
  | 'onSaveCribDemographics'
>;

export const resolvePatientRowModalMountState = ({
  showDemographics,
  showClinicalDocuments,
  canOpenClinicalDocuments,
  showExamRequest,
  canOpenExamRequest,
  showImagingRequest,
  canOpenImagingRequest,
  showHistory,
  canOpenHistory,
}: Pick<
  PatientRowModalsProps,
  | 'showDemographics'
  | 'showClinicalDocuments'
  | 'canOpenClinicalDocuments'
  | 'showExamRequest'
  | 'canOpenExamRequest'
  | 'showImagingRequest'
  | 'canOpenImagingRequest'
  | 'showHistory'
  | 'canOpenHistory'
>) => {
  const visibilityState = resolvePatientRowModalVisibilityState({
    showDemographics,
    showClinicalDocuments,
    canOpenClinicalDocuments,
    showExamRequest,
    canOpenExamRequest,
    showImagingRequest,
    canOpenImagingRequest,
    showHistory,
    canOpenHistory,
  });

  return {
    visibilityState,
    shouldRenderAnyModal:
      visibilityState.shouldRenderDemographics ||
      visibilityState.shouldRenderClinicalDocuments ||
      visibilityState.shouldRenderExamRequest ||
      visibilityState.shouldRenderImagingRequest ||
      visibilityState.shouldRenderHistory,
  };
};

export const buildPatientRowModalRenderModel = ({
  bedId,
  data,
  isSubRow,
  showDemographics,
  showClinicalDocuments,
  canOpenClinicalDocuments,
  showExamRequest,
  canOpenExamRequest,
  showImagingRequest,
  canOpenImagingRequest,
  showHistory,
  canOpenHistory,
  onSaveDemographics,
  onSaveCribDemographics,
}: PatientRowModalRenderInput): PatientRowModalRenderModel => {
  const demographicsBinding = resolvePatientRowDemographicsBinding({
    bedId,
    isSubRow,
    data,
    onSaveDemographics,
    onSaveCribDemographics,
  });
  const { visibilityState, shouldRenderAnyModal } = resolvePatientRowModalMountState({
    showDemographics,
    showClinicalDocuments,
    canOpenClinicalDocuments,
    showExamRequest,
    canOpenExamRequest,
    showImagingRequest,
    canOpenImagingRequest,
    showHistory,
    canOpenHistory,
  });

  return {
    demographicsBinding,
    visibilityState,
    shouldRenderAnyModal,
    // Keep the modal instance stable while the same bed/context is open.
    // Identity fields can change during the initial activation flow and
    // should not remount the modal unexpectedly.
    demographicsKey: `demographics-${demographicsBinding.targetBedId}-${showDemographics ? 'open' : 'closed'}-${demographicsBinding.isRnIdentityContext ? 'rn' : 'standard'}`,
    historyPatientRut: data.rut || '',
    historyPatientName: data.patientName,
  };
};
