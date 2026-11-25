import type { PatientData } from '@/types/domain/patient';

import type { TableColumnConfig } from '@/context/TableConfigContext';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import type { BedTypesById, UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';

import type { UserRole } from '@/types/authRoleTypes';
import type { PatientActionMenuIndicators } from '@/features/census/components/patient-row/patientRowActionContracts';

export interface CensusTableHeaderProps {
  scoresAction?: import('react').ReactNode;
  readOnly: boolean;
  columns: TableColumnConfig;
  isEditMode: boolean;
  canDeleteRecord: boolean;
  resetDayDeniedMessage: string;
  onClearAll: () => Promise<void>;
  accessProfile?: CensusAccessProfile;
  onResizeColumn: (column: keyof TableColumnConfig) => (width: number) => void;
}

export interface CensusTableBodyProps {
  unifiedRows: UnifiedBedRow[];
  currentDateString: string;
  recordLastUpdated?: string;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  columns: TableColumnConfig;
  visibleColumnCount: number;
  bedTypes: BedTypesById;
  role?: UserRole;
  accessProfile?: CensusAccessProfile;
  clinicalDocumentPresenceByBedId: Record<string, boolean>;
  /** RUTs discharged on this census day (for same-day readmission badge). */
  dischargedRuts?: ReadonlySet<string>;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  onActivateEmptyBed: (bedId: string) => void;
}

export interface CensusTableResolvedOccupiedRow {
  row: Extract<UnifiedBedRow, { kind: 'occupied' }>;
  actionMenuAlign: RowMenuAlign;
  indicators: Required<PatientActionMenuIndicators>;
}
