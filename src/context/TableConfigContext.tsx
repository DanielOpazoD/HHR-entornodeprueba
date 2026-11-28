/**
 * TableConfigContext
 * Lightweight context contract and consumer hook for census table column widths.
 * The Firestore-backed provider lives in `TableConfigProvider.tsx` so remote table
 * settings sync stays outside `app-authenticated-shell`.
 */

import { createContext, useContext } from 'react';
import {
  DEFAULT_COLUMN_WIDTHS,
  type TableColumnConfig,
  type TableConfig,
} from '@/services/storage/tableConfigDefaults';

export interface TableConfigContextType {
  config: TableConfig;
  isEditMode: boolean;
  isLoading: boolean;
  setEditMode: (enabled: boolean) => void;
  updateColumnWidth: (column: keyof TableColumnConfig, width: number) => void;
  updatePageMargin: (margin: number) => void;
  resetToDefaults: () => void;
  exportConfig: () => void;
  importConfig: (file: File) => Promise<void>;
}

export const TableConfigContext = createContext<TableConfigContextType | undefined>(undefined);

export const useTableConfig = (): TableConfigContextType => {
  const context = useContext(TableConfigContext);
  if (!context) {
    throw new Error('useTableConfig must be used within a TableConfigProvider');
  }
  return context;
};

export type { TableConfig, TableColumnConfig };
export { DEFAULT_COLUMN_WIDTHS };
