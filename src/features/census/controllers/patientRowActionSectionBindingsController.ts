import type { PatientMainRowViewProps } from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientMainRowActionCellProps } from '@/features/census/components/patient-row/patientRowContracts';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';
import { hasMeaningfulPatientIdentity } from '@/features/census/controllers/patientIdentityController';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import type { PatientClinicalAccessProps } from '@/features/census/components/patient-row/patientRowInputViewContracts';
import { resolvePatientActionMenuViewState } from '@/features/census/controllers/patientActionMenuViewController';

export type PatientActionSectionBinding = PatientMainRowActionCellProps;

const buildMedicalIndicationsPatientOption = ({
  data,
  currentDateString,
}: Pick<
  PatientMainRowViewProps,
  'data' | 'currentDateString'
>): MedicalIndicationsPatientOption => {
  const daysHospitalized = calculateHospitalizedDays({
    admissionDate: data.admissionDate,
    currentDate: currentDateString,
  });

  return {
    bedId: data.bedId,
    label: `${data.bedId} - ${data.patientName || 'Paciente sin nombre'}`,
    patientName: data.patientName || '',
    rut: data.rut || '',
    diagnosis: data.pathology || '',
    age: data.age || '',
    birthDate: data.birthDate || '',
    allergies: '',
    admissionDate: data.admissionDate || '',
    admissionTime: data.admissionTime,
    clinicalEpisodeId: data.clinicalEpisodeId,
    sourceDailyRecordDate: currentDateString,
    daysOfStay: String(daysHospitalized ?? ''),
    treatingDoctor: '',
  };
};

const resolveRowActionCallback = <TAction extends (() => void) | undefined>(
  canUseAction: boolean,
  action: TAction
): TAction | undefined => (canUseAction ? action : undefined);

export const buildPatientActionSectionBinding = ({
  isBlocked,
  readOnly,
  clinicalEditingDisabled,
  actionMenuAlign,
  indicators,
  mainRowViewState,
  accessProfile,
  data,
  currentDateString,
  onAction,
  onOpenDemographics,
  onOpenClinicalDocuments,
  onOpenExamRequest,
  onOpenImagingRequest,
  onOpenHistory,
  clinicalDocumentCount,
}: Pick<
  PatientMainRowViewProps,
  | 'isBlocked'
  | 'readOnly'
  | 'clinicalEditingDisabled'
  | 'actionMenuAlign'
  | 'indicators'
  | 'mainRowViewState'
  | 'accessProfile'
  | 'data'
  | 'currentDateString'
  | 'onAction'
  | 'onOpenDemographics'
  | 'onOpenClinicalDocuments'
  | 'onOpenExamRequest'
  | 'onOpenImagingRequest'
  | 'onOpenHistory'
> & { clinicalDocumentCount?: number }): PatientActionSectionBinding => {
  const daysHospitalized = calculateHospitalizedDays({
    admissionDate: data.admissionDate,
    currentDate: currentDateString,
  });
  const medicalIndicationsPatient = buildMedicalIndicationsPatientOption({
    data,
    currentDateString,
  });
  const hasPatientIdentity = hasMeaningfulPatientIdentity(data);

  return {
    isBlocked,
    readOnly,
    clinicalEditingDisabled,
    align: actionMenuAlign,
    showCmaAction: daysHospitalized === null || daysHospitalized <= 1,
    accessProfile,
    hasPatientIdentity,
    hasClinicalDocument: indicators.hasClinicalDocument,
    isNewAdmission: indicators.isNewAdmission,
    onAction,
    onViewDemographics: onOpenDemographics,
    onViewClinicalDocuments: resolveRowActionCallback(
      mainRowViewState.rowActionsAvailability.canOpenClinicalDocuments,
      onOpenClinicalDocuments
    ),
    onViewExamRequest: resolveRowActionCallback(
      mainRowViewState.rowActionsAvailability.canOpenExamRequest,
      onOpenExamRequest
    ),
    onViewImagingRequest: resolveRowActionCallback(
      mainRowViewState.rowActionsAvailability.canOpenImagingRequest,
      onOpenImagingRequest
    ),
    onViewMedicalIndications: hasPatientIdentity ? () => undefined : undefined,
    onViewHistory: resolveRowActionCallback(
      mainRowViewState.rowActionsAvailability.canOpenHistory,
      onOpenHistory
    ),
    medicalIndicationsPatient: hasPatientIdentity ? medicalIndicationsPatient : undefined,
    clinicalDocumentCount,
    canMarkInvalid: Boolean(data.clinicalEpisodeId?.trim()),
    clinicalPatient: !isBlocked && hasPatientIdentity ? data : undefined,
    censusDate: currentDateString,
  };
};

/**
 * The «Accesos» cell offers the same requests and documents the row menu would: requests only
 * when the row can edit, documents to the roles that read them.
 */
export const buildPatientClinicalAccessBinding = (
  action: PatientActionSectionBinding
): PatientClinicalAccessProps | undefined => {
  if (!action.clinicalPatient) return undefined;
  const view = resolvePatientActionMenuViewState({
    isBlocked: action.isBlocked,
    readOnly: action.readOnly,
    clinicalEditingDisabled: action.clinicalEditingDisabled,
    accessProfile: action.accessProfile,
    hasPatientIdentity: action.hasPatientIdentity,
    hasHistoryAction: Boolean(action.onViewHistory),
    hasClinicalDocumentsAction: Boolean(action.onViewClinicalDocuments),
    hasExamRequestAction: Boolean(action.onViewExamRequest),
    hasImagingRequestAction: Boolean(action.onViewImagingRequest),
  });
  return {
    patient: action.clinicalPatient,
    censusDate: action.censusDate,
    onRequestExams: view.showExamRequestAction ? action.onViewExamRequest : undefined,
    onRequestImaging: view.showImagingRequestAction ? action.onViewImagingRequest : undefined,
    onViewClinicalDocuments: view.showClinicalDocumentsAction
      ? action.onViewClinicalDocuments
      : undefined,
    clinicalDocumentCount: action.clinicalDocumentCount,
  };
};
