/**
 * Table Configuration Context
 * Manages table column widths with Firebase sync
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  TableConfig,
  TableColumnConfig,
  getDefaultConfig,
  getInitialTableConfig,
  DEFAULT_COLUMN_WIDTHS,
  saveTableConfig,
  setFirestoreEnabled as setTableConfigFirestoreEnabled,
  subscribeToTableConfig,
  exportTableConfig,
  importTableConfig,
} from '@/services/storage/tableConfigService';
import { useAuth } from './AuthContext';
import { tableConfigLogger } from '@/services/storage/storageLoggers';

// ============================================================================
// Context Types
// ============================================================================

interface TableConfigContextType {
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

// ============================================================================
// Context
// ============================================================================

const TableConfigContext = createContext<TableConfigContextType | undefined>(undefined);

const isE2ETableConfigRemoteDisabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as Window & { __HHR_E2E_OVERRIDE__?: unknown }).__HHR_E2E_OVERRIDE__ ||
    window.localStorage?.getItem('hhr_e2e_bootstrap_user')
  );
};

// ============================================================================
// Provider
// ============================================================================

export const TableConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { remoteSyncStatus } = useAuth();
  const [config, setConfig] = useState<TableConfig>(getInitialTableConfig);
  const [isEditMode, setIsEditMode] = useState(false);
  const [hasRemoteConfigSnapshot, setHasRemoteConfigSnapshot] = useState(false);
  const remoteTableConfigDisabled = isE2ETableConfigRemoteDisabled();

  // Debounce timer for saves
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localUpdateRef = useRef(false);

  // Load initial config and subscribe
  useEffect(() => {
    setTableConfigFirestoreEnabled(remoteSyncStatus === 'ready' && !remoteTableConfigDisabled);

    if (remoteSyncStatus !== 'ready' || remoteTableConfigDisabled) {
      return;
    }

    // Subscribe to real-time updates
    const unsubscribe = subscribeToTableConfig(newConfig => {
      // Skip if this update came from our local save
      if (!localUpdateRef.current) {
        setConfig(newConfig);
      }
      localUpdateRef.current = false;
      setHasRemoteConfigSnapshot(true);
    });

    return () => unsubscribe();
  }, [remoteSyncStatus, remoteTableConfigDisabled]);

  // Debounced save to Firebase
  const debouncedSave = useCallback((newConfig: TableConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      localUpdateRef.current = true;
      saveTableConfig(newConfig).catch(error => {
        tableConfigLogger.error('Failed to persist table config from debounce', error);
      });
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  // Update single column width
  const updateColumnWidth = useCallback(
    (column: keyof TableColumnConfig, width: number) => {
      setConfig(prev => {
        const baseConfig = remoteSyncStatus === 'ready' ? prev : getDefaultConfig();
        const newConfig = {
          ...baseConfig,
          columns: {
            ...baseConfig.columns,
            [column]: Math.max(24, Math.min(400, width)), // Clamp between 24-400px
          },
        };
        debouncedSave(newConfig);
        return newConfig;
      });
    },
    [debouncedSave, remoteSyncStatus]
  );

  // Update page margin
  const updatePageMargin = useCallback(
    (margin: number) => {
      setConfig(prev => {
        const baseConfig = remoteSyncStatus === 'ready' ? prev : getDefaultConfig();
        const newConfig = {
          ...baseConfig,
          pageMargin: Math.max(0, Math.min(64, margin)), // Clamp between 0-64px
        };
        debouncedSave(newConfig);
        return newConfig;
      });
    },
    [debouncedSave, remoteSyncStatus]
  );

  // Reset to default widths
  const resetToDefaults = useCallback(() => {
    const newConfig = getDefaultConfig();
    setConfig(newConfig);
    saveTableConfig(newConfig).catch(error => {
      tableConfigLogger.error('Failed to reset table config to defaults', error);
    });
  }, []);

  // Export current config
  const exportConfig = useCallback(() => {
    exportTableConfig(config);
  }, [config]);

  // Import config from file
  const handleImportConfig = useCallback(async (file: File) => {
    try {
      const importedConfig = await importTableConfig(file);
      setConfig(importedConfig);
      await saveTableConfig(importedConfig);
    } catch (error) {
      tableConfigLogger.error('Failed to import config', error);
      throw error;
    }
  }, []);

  // Toggle edit mode
  const setEditMode = useCallback((enabled: boolean) => {
    setIsEditMode(enabled);
  }, []);

  const visibleConfig =
    remoteSyncStatus === 'ready' || remoteSyncStatus === 'bootstrapping'
      ? config
      : getDefaultConfig();
  const isLoading =
    !remoteTableConfigDisabled &&
    (remoteSyncStatus === 'bootstrapping' ||
      (remoteSyncStatus === 'ready' && !hasRemoteConfigSnapshot));

  return (
    <TableConfigContext.Provider
      value={{
        config: visibleConfig,
        isEditMode,
        isLoading,
        setEditMode,
        updateColumnWidth,
        updatePageMargin,
        resetToDefaults,
        exportConfig,
        importConfig: handleImportConfig,
      }}
    >
      {children}
    </TableConfigContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

export const useTableConfig = (): TableConfigContextType => {
  const context = useContext(TableConfigContext);
  if (!context) {
    throw new Error('useTableConfig must be used within a TableConfigProvider');
  }
  return context;
};

// Re-export types and utilities
export type { TableConfig, TableColumnConfig };
export { DEFAULT_COLUMN_WIDTHS };
