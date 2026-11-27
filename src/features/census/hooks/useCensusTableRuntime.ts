import { useCallback } from 'react';
import type { TableColumnConfig } from '@/context/TableConfigContext';
import { useEmptyBedActivation } from '../components/useEmptyBedActivation';
import { useCensusTableDependencies } from './useCensusTableDependencies';
import { useCensusTableModel } from './useCensusTableModel';

const NO_EXTRA_BEDS: string[] = [];

interface UseCensusTableRuntimeParams {
  currentDateString: string;
}

export const useCensusTableRuntime = ({ currentDateString }: UseCensusTableRuntimeParams) => {
  const dependencies = useCensusTableDependencies();
  const { columns } = dependencies.config;
  const { activateEmptyBed } = useEmptyBedActivation();
  const tableModel = useCensusTableModel({
    currentDateString,
    role: dependencies.role,
    beds: dependencies.beds,
    activeExtraBeds: dependencies.staff?.activeExtraBeds || NO_EXTRA_BEDS,
    overrides: dependencies.overrides,
    columns,
    resetDay: dependencies.resetDay,
    confirm: dependencies.confirm,
    warning: dependencies.warning,
  });
  const { updateColumnWidth } = dependencies;
  const handleColumnResize = useCallback(
    (column: keyof TableColumnConfig) => (width: number) => {
      updateColumnWidth(column, width);
    },
    [updateColumnWidth]
  );

  return {
    ...dependencies,
    columns,
    tableConfigLoading: dependencies.tableConfigLoading,
    activateEmptyBed,
    handleColumnResize,
    ...tableModel,
  };
};
