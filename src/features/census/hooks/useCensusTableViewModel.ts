import { useCallback } from 'react';
import {
  useDailyRecordActions,
  useDailyRecordBeds,
  useDailyRecordOverrides,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import { useCensusActionCommands } from '@/features/census/components/CensusActionsContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig, type TableColumnConfig } from '@/context/TableConfigContext';
import { useEmptyBedActivation } from '@/features/census/components/useEmptyBedActivation';
import { useDiagnosisMode } from '@/features/census/hooks/useDiagnosisMode';
import { useCensusTableModel } from '@/features/census/hooks/useCensusTableModel';

interface UseCensusTableViewModelParams {
  currentDateString: string;
}

export const useCensusTableViewModel = ({ currentDateString }: UseCensusTableViewModelParams) => {
  const beds = useDailyRecordBeds();
  const staff = useDailyRecordStaff();
  const overrides = useDailyRecordOverrides();
  const { resetDay, updatePatient } = useDailyRecordActions();
  const { handleRowAction } = useCensusActionCommands();
  const { confirm } = useConfirmDialog();
  const { warning } = useNotification();
  const { role } = useAuth();
  const { config, isEditMode, updateColumnWidth } = useTableConfig();
  const { diagnosisMode, toggleDiagnosisMode } = useDiagnosisMode();
  const { activateEmptyBed } = useEmptyBedActivation({ updatePatient });
  const { columns } = config;

  const model = useCensusTableModel({
    currentDateString,
    role,
    beds,
    activeExtraBeds: staff?.activeExtraBeds || [],
    overrides,
    columns,
    resetDay,
    confirm,
    warning,
  });

  const handleColumnResize = useCallback(
    (column: keyof TableColumnConfig) => (width: number) => {
      updateColumnWidth(column, width);
    },
    [updateColumnWidth]
  );

  return {
    beds,
    handleRowAction,
    diagnosisMode,
    toggleDiagnosisMode,
    activateEmptyBed,
    columns,
    isEditMode,
    handleColumnResize,
    ...model,
  };
};
