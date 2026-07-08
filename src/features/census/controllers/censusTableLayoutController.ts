import type { CSSProperties } from 'react';
import type { TableColumnConfig } from '@/context/TableConfigContext';
import type {
  DiagnosisMode,
  UnifiedBedRow,
  BedTypesById,
} from '@/features/census/types/censusTableTypes';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import type { UserRole } from '@/types/authRoleTypes';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type {
  CensusTableBodyProps,
  CensusTableHeaderProps,
} from '@/features/census/types/censusTableComponentContracts';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { HydratedRemoteClinicalFieldLocksByBedId } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';
import {
  resolveVisibleCensusColumnCount,
  resolveVisibleCensusColumns,
  resolveVisibleCensusTotalWidth,
} from '@/features/census/controllers/censusTableColumnProfileController';

export interface CensusTableLayoutParams {
  currentDateString: string;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  clinicalFieldLocksByBedId?: HydratedRemoteClinicalFieldLocksByBedId;
  columns: TableColumnConfig;
  isEditMode: boolean;
  canDeleteRecord: boolean;
  resetDayDeniedMessage: string;
  onClearAll: () => Promise<void>;
  diagnosisMode: DiagnosisMode;
  accessProfile?: CensusAccessProfile;
  onToggleDiagnosisMode: () => void;
  onResizeColumn: (column: keyof TableColumnConfig) => (width: number) => void;
  unifiedRows: UnifiedBedRow[];
  bedTypes: BedTypesById;
  role?: UserRole;
  clinicalDocumentPresenceByBedId: Record<string, boolean>;
  dischargedRuts?: ReadonlySet<string>;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  onActivateEmptyBed: (bedId: string) => void;
  totalWidth: number;
}

export interface CensusTableLayoutBindings {
  headerProps: CensusTableHeaderProps;
  bodyProps: CensusTableBodyProps;
  tableStyle: CSSProperties;
}

interface CensusTableProjection {
  projectedColumns: ReturnType<typeof resolveVisibleCensusColumns>;
  visibleColumnCount: number;
  visibleTotalWidth: number;
}

export const resolveCensusTableStyle = (totalWidth: number): CSSProperties => ({
  width: `${totalWidth}px`,
  minWidth: '100%',
});

export const resolveCensusTableProjection = (
  columns: TableColumnConfig,
  accessProfile?: CensusAccessProfile
): CensusTableProjection => ({
  projectedColumns: resolveVisibleCensusColumns(columns, accessProfile),
  visibleColumnCount: resolveVisibleCensusColumnCount(columns, accessProfile),
  visibleTotalWidth: resolveVisibleCensusTotalWidth(columns, accessProfile),
});

export const buildCensusTableLayoutBindings = (
  params: CensusTableLayoutParams
): CensusTableLayoutBindings => {
  const { projectedColumns, visibleColumnCount, visibleTotalWidth } = resolveCensusTableProjection(
    params.columns,
    params.accessProfile
  );

  return {
    headerProps: {
      readOnly: params.readOnly,
      columns: projectedColumns,
      isEditMode: params.isEditMode,
      canDeleteRecord: params.canDeleteRecord,
      resetDayDeniedMessage: params.resetDayDeniedMessage,
      onClearAll: params.onClearAll,
      diagnosisMode: params.diagnosisMode,
      accessProfile: params.accessProfile,
      onToggleDiagnosisMode: params.onToggleDiagnosisMode,
      onResizeColumn: params.onResizeColumn,
    },
    bodyProps: {
      unifiedRows: params.unifiedRows,
      currentDateString: params.currentDateString,
      readOnly: params.readOnly,
      clinicalEditingDisabled: params.clinicalEditingDisabled,
      clinicalFieldLocksByBedId: params.clinicalFieldLocksByBedId,
      diagnosisMode: params.diagnosisMode,
      columns: projectedColumns,
      visibleColumnCount,
      bedTypes: params.bedTypes,
      role: params.role,
      accessProfile: params.accessProfile,
      clinicalDocumentPresenceByBedId: params.clinicalDocumentPresenceByBedId,
      dischargedRuts: params.dischargedRuts,
      onAction: params.onAction,
      onActivateEmptyBed: params.onActivateEmptyBed,
    },
    tableStyle: resolveCensusTableStyle(visibleTotalWidth),
  };
};
