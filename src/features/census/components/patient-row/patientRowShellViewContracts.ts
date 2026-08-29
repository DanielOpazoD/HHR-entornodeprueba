import type { CSSProperties, DragEvent } from 'react';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { BedDefinition, BedType } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowDataContracts';
import type { UserRole } from '@/types/authRoleTypes';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { PatientActionMenuIndicators } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type { HydratedRemoteClinicalFieldLocks } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export interface PatientRowModalsProps {
  bedId: string;
  data: PatientData;
  currentDateString: string;
  isSubRow: boolean;
  showDemographics: boolean;
  showClinicalDocuments: boolean;
  canOpenClinicalDocuments: boolean;
  showExamRequest: boolean;
  canOpenExamRequest: boolean;
  showImagingRequest: boolean;
  canOpenImagingRequest: boolean;
  showHistory: boolean;
  canOpenHistory: boolean;
  onCloseDemographics: () => void;
  onCloseClinicalDocuments: () => void;
  onCloseExamRequest: () => void;
  onCloseImagingRequest: () => void;
  onCloseHistory: () => void;
  onSaveDemographics: (fields: Partial<PatientData>) => void;
  onSaveCribDemographics: (fields: Partial<PatientData>) => void;
  onRevertEmptyDemographics: () => void;
  canUseArbitraryAdmissionDate?: boolean;
}

export interface PatientRowProps {
  bed: BedDefinition;
  data: PatientData;
  currentDateString: string;
  recordLastUpdated?: string;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  readOnly?: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocks?: HydratedRemoteClinicalFieldLocks;
  actionMenuAlign?: RowMenuAlign;
  diagnosisMode?: DiagnosisMode;
  isSubRow?: boolean;
  bedType: BedType;
  role?: UserRole;
  accessProfile?: CensusAccessProfile;
  indicators?: PatientActionMenuIndicators;
  style?: CSSProperties;
  draggable?: boolean;
  isDragging?: boolean;
  isPendingClear?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  clinicalDocumentCount?: number;
}
