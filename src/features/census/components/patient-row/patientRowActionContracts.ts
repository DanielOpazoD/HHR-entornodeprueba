import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

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
  onViewMedicalIndications?: () => void;
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
  showMedicalIndicationsAction: boolean;
}

export interface PatientActionMenuBinding {
  align: RowMenuAlign;
  isBlocked: boolean;
  readOnly: boolean;
  showCmaAction: boolean;
  accessProfile?: CensusAccessProfile;
  indicators: Required<PatientActionMenuIndicators>;
  availability: PatientActionMenuAvailability;
  medicalIndicationsPatient?: MedicalIndicationsPatientOption;
}
