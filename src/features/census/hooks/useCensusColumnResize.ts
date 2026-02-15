import { useCallback } from 'react';
import type { TableColumnConfig } from '@/context/TableConfigContext';

interface UseCensusColumnResizeParams {
  updateColumnWidth: (column: keyof TableColumnConfig, width: number) => void;
}

interface UseCensusColumnResizeResult {
  handleColumnResize: (column: keyof TableColumnConfig) => (width: number) => void;
}

export const useCensusColumnResize = ({
  updateColumnWidth,
}: UseCensusColumnResizeParams): UseCensusColumnResizeResult => {
  const handleColumnResize = useCallback(
    (column: keyof TableColumnConfig) => (width: number) => {
      updateColumnWidth(column, width);
    },
    [updateColumnWidth]
  );

  return { handleColumnResize };
};
