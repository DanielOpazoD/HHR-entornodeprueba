import type { CSSProperties, DragEvent } from 'react';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { BedDefinition, BedType } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowDataContracts';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type {
  ClinicalCribInputChangeHandlers,
  MainPatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';
import type {
  PatientActionMenuActionFilter,
  PatientActionMenuCallbacks,
  PatientActionMenuIndicators,
} from '@/features/census/components/patient-row/patientRowActionContracts';
import type { PatientBedConfigCallbacks } from '@/features/census/components/patient-row/patientRowBedConfigContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type { PatientMainRowViewState } from '@/features/census/controllers/patientRowMainViewController';
import type { HydratedRemoteClinicalFieldLocks } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export interface PatientMainRowActionCellProps
  extends
    PatientActionMenuCallbacks,
    PatientActionMenuActionFilter,
    Required<PatientActionMenuIndicators> {
  isBlocked: boolean;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  align: RowMenuAlign;
  showCmaAction?: boolean;
  accessProfile?: CensusAccessProfile;
  hasPatientIdentity?: boolean;
  medicalIndicationsPatient?: MedicalIndicationsPatientOption;
  clinicalDocumentCount?: number;
  isPendingClear?: boolean;
}

export interface PatientMainRowViewProps
  extends
    Omit<
      PatientActionMenuCallbacks,
      'onViewDemographics' | 'onViewExamRequest' | 'onViewImagingRequest' | 'onViewHistory'
    >,
    PatientBedConfigCallbacks {
  bed: BedDefinition;
  bedType: BedType;
  data: PatientData;
  currentDateString: string;
  style?: CSSProperties;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocks?: HydratedRemoteClinicalFieldLocks;
  actionMenuAlign: RowMenuAlign;
  diagnosisMode: DiagnosisMode;
  isBlocked: boolean;
  isEmpty: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
  isCunaMode: boolean;
  indicators: Required<PatientActionMenuIndicators>;
  mainRowViewState: PatientMainRowViewState;
  accessProfile?: CensusAccessProfile;
  onOpenDemographics: () => void;
  onOpenClinicalDocuments: () => void;
  onOpenExamRequest: () => void;
  onOpenImagingRequest: () => void;
  onOpenHistory: () => void;
  onToggleBedType: () => void;
  onChange: MainPatientInputChangeHandlers;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  clinicalDocumentCount?: number;
  isPendingClear?: boolean;
}

export interface PatientSubRowViewProps {
  data: PatientData;
  currentDateString: string;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocks?: HydratedRemoteClinicalFieldLocks;
  diagnosisMode: DiagnosisMode;
  accessProfile?: CensusAccessProfile;
  style?: CSSProperties;
  isPendingClear?: boolean;
  onOpenDemographics: () => void;
  onOpenHistory: () => void;
  onRemoveClinicalCrib: () => Promise<void>;
  onChange: ClinicalCribInputChangeHandlers;
}
