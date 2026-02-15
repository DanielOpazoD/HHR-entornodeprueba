import type { CSSProperties } from 'react';
import type { TableColumnConfig } from '@/context/TableConfigContext';
import type {
  DiagnosisMode,
  OccupiedBedRow,
  BedTypesById,
} from '@/features/census/types/censusTableTypes';
import type { BedDefinition, PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type {
  CensusTableBodyProps,
  CensusTableHeaderProps,
} from '@/features/census/types/censusTableComponentContracts';

export interface CensusTableLayoutParams {
  currentDateString: string;
  readOnly: boolean;
  columns: TableColumnConfig;
  isEditMode: boolean;
  canDeleteRecord: boolean;
  resetDayDeniedMessage: string;
  onClearAll: () => Promise<void>;
  diagnosisMode: DiagnosisMode;
  onToggleDiagnosisMode: () => void;
  onResizeColumn: (column: keyof TableColumnConfig) => (width: number) => void;
  occupiedRows: OccupiedBedRow[];
  emptyBeds: BedDefinition[];
  bedTypes: BedTypesById;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  onActivateEmptyBed: (bedId: string) => void;
  totalWidth: number;
}

export interface CensusTableLayoutBindings {
  headerProps: CensusTableHeaderProps;
  bodyProps: CensusTableBodyProps;
  tableStyle: CSSProperties;
}

export const resolveCensusTableStyle = (totalWidth: number): CSSProperties => ({
  width: `${totalWidth}px`,
  minWidth: '100%',
});

export const buildCensusTableLayoutBindings = (
  params: CensusTableLayoutParams
): CensusTableLayoutBindings => ({
  headerProps: {
    readOnly: params.readOnly,
    columns: params.columns,
    isEditMode: params.isEditMode,
    canDeleteRecord: params.canDeleteRecord,
    resetDayDeniedMessage: params.resetDayDeniedMessage,
    onClearAll: params.onClearAll,
    diagnosisMode: params.diagnosisMode,
    onToggleDiagnosisMode: params.onToggleDiagnosisMode,
    onResizeColumn: params.onResizeColumn,
  },
  bodyProps: {
    occupiedRows: params.occupiedRows,
    emptyBeds: params.emptyBeds,
    currentDateString: params.currentDateString,
    readOnly: params.readOnly,
    diagnosisMode: params.diagnosisMode,
    bedTypes: params.bedTypes,
    onAction: params.onAction,
    onActivateEmptyBed: params.onActivateEmptyBed,
  },
  tableStyle: resolveCensusTableStyle(params.totalWidth),
});
