import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';

export interface PatientActionMenuIndicators {
  hasClinicalDocument?: boolean;
  isNewAdmission?: boolean;
}

export interface PatientActionMenuCallbacks {
  onAction: (action: PatientRowAction) => void;
  onViewDemographics: () => void;
  onViewClinicalDocuments?: () => void;
  onViewExamRequest?: () => void;
  onViewImagingRequest?: () => void;
  onViewHistory?: () => void;
}

export interface PatientActionMenuActionFilter {
  allowedActions?: readonly PatientRowAction[];
}

export interface PatientActionMenuAvailability {
  showDemographicsAction: boolean;
  showMenuTrigger: boolean;
  showHistoryAction: boolean;
  showUtilityActions: boolean;
  showClinicalSection: boolean;
  showBuiltInClinicalActions: boolean;
  showClinicalDocumentsAction: boolean;
  showExamRequestAction: boolean;
  showImagingRequestAction: boolean;
}

export interface PatientActionMenuBinding {
  align: RowMenuAlign;
  isBlocked: boolean;
  readOnly: boolean;
  showCmaAction: boolean;
  accessProfile?: CensusAccessProfile;
  indicators: Required<PatientActionMenuIndicators>;
  availability: PatientActionMenuAvailability;
}
