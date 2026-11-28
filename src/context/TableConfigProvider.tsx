/**
 * TableConfigProvider
 * Firestore-backed runtime provider for census table column widths and margins.
 * Loaded asynchronously through `DeferredTableConfigProvider` so its storage
 * runtime stays in its own precached chunk outside `app-authenticated-shell`.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getDefaultConfig,
  getInitialTableConfig,
  isE2ETableConfigRemoteDisabled,
  type TableColumnConfig,
  type TableConfig,
} from '@/services/storage/tableConfigDefaults';
import {
  saveTableConfig,
  setFirestoreEnabled as setTableConfigFirestoreEnabled,
  subscribeToTableConfig,
} from '@/services/storage/tableConfigService';
import { useAuth } from './AuthContext';
import { tableConfigLogger } from '@/services/storage/storageLoggers';
import { TableConfigContext, type TableConfigContextType } from './TableConfigContext';

export const TableConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { remoteSyncStatus } = useAuth();
  const [config, setConfig] = useState<TableConfig>(getInitialTableConfig);
  const [isEditMode, setIsEditMode] = useState(false);
  const [hasRemoteConfigSnapshot, setHasRemoteConfigSnapshot] = useState(false);
  const remoteTableConfigDisabled = isE2ETableConfigRemoteDisabled();

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localUpdateRef = useRef(false);

  useEffect(() => {
    setTableConfigFirestoreEnabled(remoteSyncStatus === 'ready' && !remoteTableConfigDisabled);

    if (remoteSyncStatus !== 'ready' || remoteTableConfigDisabled) {
      return;
    }

    const unsubscribe = subscribeToTableConfig(newConfig => {
      if (!localUpdateRef.current) {
        setConfig(newConfig);
      }
      localUpdateRef.current = false;
      setHasRemoteConfigSnapshot(true);
    });

    return () => unsubscribe();
  }, [remoteSyncStatus, remoteTableConfigDisabled]);

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

  const updateColumnWidth = useCallback(
    (column: keyof TableColumnConfig, width: number) => {
      setConfig(prev => {
        const baseConfig = remoteSyncStatus === 'ready' ? prev : getDefaultConfig();
        const newConfig = {
          ...baseConfig,
          columns: {
            ...baseConfig.columns,
            [column]: Math.max(24, Math.min(400, width)),
          },
        };
        debouncedSave(newConfig);
        return newConfig;
      });
    },
    [debouncedSave, remoteSyncStatus]
  );

  const updatePageMargin = useCallback(
    (margin: number) => {
      setConfig(prev => {
        const baseConfig = remoteSyncStatus === 'ready' ? prev : getDefaultConfig();
        const newConfig = {
          ...baseConfig,
          pageMargin: Math.max(0, Math.min(64, margin)),
        };
        debouncedSave(newConfig);
        return newConfig;
      });
    },
    [debouncedSave, remoteSyncStatus]
  );

  const resetToDefaults = useCallback(() => {
    const newConfig = getDefaultConfig();
    setConfig(newConfig);
    saveTableConfig(newConfig).catch(error => {
      tableConfigLogger.error('Failed to reset table config to defaults', error);
    });
  }, []);

  const exportConfig = useCallback(() => {
    void import('@/services/storage/tableConfigTransfer')
      .then(({ exportTableConfig }) => exportTableConfig(config))
      .catch(error => {
        tableConfigLogger.error('Failed to export config', error);
      });
  }, [config]);

  const handleImportConfig = useCallback(async (file: File) => {
    try {
      const { importTableConfig } = await import('@/services/storage/tableConfigTransfer');
      const importedConfig = await importTableConfig(file);
      setConfig(importedConfig);
      await saveTableConfig(importedConfig);
    } catch (error) {
      tableConfigLogger.error('Failed to import config', error);
      throw error;
    }
  }, []);

  const setEditMode = useCallback((enabled: boolean) => {
    setIsEditMode(enabled);
  }, []);

  const defaultConfig = useMemo(() => getDefaultConfig(), []);
  const visibleConfig =
    remoteSyncStatus === 'ready' || remoteSyncStatus === 'bootstrapping' ? config : defaultConfig;
  const isLoading =
    !remoteTableConfigDisabled &&
    (remoteSyncStatus === 'bootstrapping' ||
      (remoteSyncStatus === 'ready' && !hasRemoteConfigSnapshot));

  const contextValue = useMemo<TableConfigContextType>(
    () => ({
      config: visibleConfig,
      isEditMode,
      isLoading,
      setEditMode,
      updateColumnWidth,
      updatePageMargin,
      resetToDefaults,
      exportConfig,
      importConfig: handleImportConfig,
    }),
    [
      visibleConfig,
      isEditMode,
      isLoading,
      setEditMode,
      updateColumnWidth,
      updatePageMargin,
      resetToDefaults,
      exportConfig,
      handleImportConfig,
    ]
  );

  return <TableConfigContext.Provider value={contextValue}>{children}</TableConfigContext.Provider>;
};
