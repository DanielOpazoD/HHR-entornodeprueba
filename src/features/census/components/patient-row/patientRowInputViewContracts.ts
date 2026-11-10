import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { BedDefinition, BedType } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowDataContracts';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type {
  EventTextHandler,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';
import type { PatientBedConfigCallbacks } from '@/features/census/components/patient-row/patientRowBedConfigContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';

/** What the «Accesos» cell needs: the patient, and the requests and documents the row allows. */
export interface PatientClinicalAccessProps {
  patient: PatientData;
  censusDate?: string;
  /** A crib reads only its ficha: laboratory, imaging and documents belong to the bed's patient. */
  isSubRow?: boolean;
  onRequestExams?: () => void;
  onRequestImaging?: () => void;
  onViewClinicalDocuments?: () => void;
  clinicalDocumentCount?: number;
}

export interface PatientInputCellsProps {
  data: PatientData;
  parentBedId?: string;
  currentDateString: string;
  isNewAdmission?: boolean;
  isSubRow?: boolean;
  isEmpty?: boolean;
  onChange: PatientInputChangeHandlers;
  onDemo: () => void;
  readOnly?: boolean;
  clinicalEditingDisabled?: boolean;
  diagnosisMode?: DiagnosisMode;
  accessProfile?: CensusAccessProfile;
  /** Absent on a bed without a patient: the «Accesos» cell stays empty. */
  clinicalAccess?: PatientClinicalAccessProps;
}

export interface PatientBedConfigProps extends PatientBedConfigCallbacks {
  bed: BedDefinition;
  data: PatientData;
  currentDateString: string;
  isBlocked: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
  isCunaMode: boolean;
  onTextChange: EventTextHandler;
  readOnly?: boolean;
  align?: RowMenuAlign;
}

export interface PatientMainRowBedTypeCellProps {
  bedId: string;
  patientRut?: string | null;
  bedType: BedType;
  hasPatient: boolean;
  canToggleBedType: boolean;
  onToggleBedType: () => void;
}

export interface PatientMainRowBlockedCellProps {
  blockedReason?: string;
  accessProfile?: CensusAccessProfile;
}
