import type { TableColumnConfig } from '@/context/TableConfigContext';
import type {
  BedTypesById,
  DiagnosisMode,
  OccupiedBedRow,
} from '@/features/census/types/censusTableTypes';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { BedDefinition, PatientData } from '@/types';

export interface CensusTableHeaderProps {
  readOnly: boolean;
  columns: TableColumnConfig;
  isEditMode: boolean;
  canDeleteRecord: boolean;
  resetDayDeniedMessage: string;
  onClearAll: () => Promise<void>;
  diagnosisMode: DiagnosisMode;
  onToggleDiagnosisMode: () => void;
  onResizeColumn: (column: keyof TableColumnConfig) => (width: number) => void;
}

export interface CensusTableBodyProps {
  occupiedRows: OccupiedBedRow[];
  emptyBeds: BedDefinition[];
  currentDateString: string;
  readOnly: boolean;
  diagnosisMode: DiagnosisMode;
  bedTypes: BedTypesById;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  onActivateEmptyBed: (bedId: string) => void;
}
