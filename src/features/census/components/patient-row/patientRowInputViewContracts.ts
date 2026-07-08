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
import type { HydratedRemoteClinicalFieldLocks } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export interface PatientInputCellsProps {
  data: PatientData;
  currentDateString: string;
  isNewAdmission?: boolean;
  isSubRow?: boolean;
  isEmpty?: boolean;
  onChange: PatientInputChangeHandlers;
  onDemo: () => void;
  readOnly?: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocks?: HydratedRemoteClinicalFieldLocks;
  diagnosisMode?: DiagnosisMode;
  accessProfile?: CensusAccessProfile;
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
