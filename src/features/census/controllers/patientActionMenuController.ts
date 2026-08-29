import {
  getVisibleUtilityActions,
  type UtilityActionConfig,
} from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { canUseCensusUtilityActions } from '@/shared/access/operationalAccessPolicy';
import type {
  PatientActionMenuBinding,
  PatientActionMenuIndicators,
} from '@/features/census/components/patient-row/patientRowActionContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { resolvePatientActionMenuBinding } from '@/features/census/controllers/patientActionMenuBindingController';

export interface PatientActionMenuCallbackAvailability {
  hasHistoryAction: boolean;
  hasClinicalDocumentsAction: boolean;
  hasExamRequestAction: boolean;
  hasImagingRequestAction: boolean;
  hasMedicalIndicationsAction?: boolean;
}

interface ResolvePatientActionMenuCallbackAvailabilityParams {
  onViewHistory?: () => void;
  onViewClinicalDocuments?: () => void;
  onViewExamRequest?: () => void;
  onViewImagingRequest?: () => void;
  onViewMedicalIndications?: () => void;
}

interface ResolvePatientActionMenuDemographicsInteractionParams {
  accessProfile?: CensusAccessProfile;
  onViewDemographics: () => void;
}

export const resolvePatientActionMenuDemographicsInteraction = ({
  accessProfile = 'default',
  onViewDemographics,
}: ResolvePatientActionMenuDemographicsInteractionParams): (() => void) | undefined =>
  accessProfile === 'specialist' ? undefined : onViewDemographics;

export const resolvePatientActionMenuCallbackAvailability = ({
  onViewHistory,
  onViewClinicalDocuments,
  onViewExamRequest,
  onViewImagingRequest,
  onViewMedicalIndications,
}: ResolvePatientActionMenuCallbackAvailabilityParams): PatientActionMenuCallbackAvailability => ({
  hasHistoryAction: typeof onViewHistory === 'function',
  hasClinicalDocumentsAction: typeof onViewClinicalDocuments === 'function',
  hasExamRequestAction: typeof onViewExamRequest === 'function',
  hasImagingRequestAction: typeof onViewImagingRequest === 'function',
  hasMedicalIndicationsAction: typeof onViewMedicalIndications === 'function',
});

interface BuildPatientActionMenuModelParams {
  align?: RowMenuAlign;
  isBlocked: boolean;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  accessProfile?: CensusAccessProfile;
  hasPatientIdentity?: boolean;
  showCmaAction?: boolean;
  indicators?: Required<PatientActionMenuIndicators>;
  callbackAvailability: PatientActionMenuCallbackAvailability;
  allowedActions?: readonly PatientRowAction[];
}

export interface PatientActionMenuModel {
  binding: PatientActionMenuBinding;
  utilityActions: UtilityActionConfig[];
}

export const buildPatientActionMenuModel = ({
  align,
  isBlocked,
  readOnly,
  clinicalEditingDisabled = false,
  accessProfile = 'default',
  hasPatientIdentity = true,
  showCmaAction,
  indicators,
  callbackAvailability,
  allowedActions,
}: BuildPatientActionMenuModelParams): PatientActionMenuModel => ({
  binding: resolvePatientActionMenuBinding({
    align,
    showCmaAction,
    isBlocked,
    readOnly,
    clinicalEditingDisabled,
    accessProfile,
    hasPatientIdentity,
    indicators,
    ...callbackAvailability,
  }),
  utilityActions: canUseCensusUtilityActions({
    readOnly: readOnly || clinicalEditingDisabled,
    accessProfile,
  })
    ? getVisibleUtilityActions(isBlocked).filter(
        action => !allowedActions || allowedActions.includes(action.action)
      )
    : [],
});
