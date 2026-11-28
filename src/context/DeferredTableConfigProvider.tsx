/**
 * DeferredTableConfigProvider
 * Publishes `TableConfigContext` immediately on first render with the last-known
 * local widths (zero first-paint width shift and no child remount), while loading
 * `TableConfigProvider` and its Firestore subscription in a separate precached chunk
 * outside `app-authenticated-shell`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  getDefaultConfig,
  getInitialTableConfig,
  isE2ETableConfigRemoteDisabled,
  type TableConfig,
} from '@/services/storage/tableConfigDefaults';
import { useAuth } from './AuthContext';
import {
  TableConfigContext,
  useTableConfig,
  type TableConfigContextType,
} from './TableConfigContext';

export type TableConfigProviderComponent = React.ComponentType<{ children: ReactNode }>;

const noop = () => undefined;
const rejectedImport = () => Promise.reject(new Error('Configuración de tabla aún cargando.'));

export const loadTableConfigProvider = async (): Promise<TableConfigProviderComponent> => {
  const module = await import('@/context/TableConfigProvider');
  return module.TableConfigProvider;
};

const TableConfigValueBridge: React.FC<{ onChange: (value: TableConfigContextType) => void }> = ({
  onChange,
}) => {
  const value = useTableConfig();
  useEffect(() => {
    onChange(value);
  }, [onChange, value]);
  return null;
};

interface DeferredTableConfigProviderProps {
  children: ReactNode;
  loader?: () => Promise<TableConfigProviderComponent>;
}

export const DeferredTableConfigProvider: React.FC<DeferredTableConfigProviderProps> = ({
  children,
  loader = loadTableConfigProvider,
}) => {
  const { remoteSyncStatus } = useAuth();
  const [Provider, setProvider] = useState<TableConfigProviderComponent | null>(null);
  const [loadedValue, setLoadedValue] = useState<TableConfigContextType | null>(null);
  const [initialConfig] = useState<TableConfig>(getInitialTableConfig);
  const [pendingEditMode, setPendingEditMode] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const pendingEditModeRef = useRef<boolean | null>(null);
  const remoteTableConfigDisabled = isE2ETableConfigRemoteDisabled();

  useEffect(() => {
    if (Provider) return undefined;
    let active = true;
    void loader()
      .then(component => {
        if (!active) return;
        setLoadFailed(false);
        setProvider(() => component);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [Provider, loader]);

  useEffect(() => {
    if (!loadedValue) return;
    if (pendingEditModeRef.current !== null) {
      const desired = pendingEditModeRef.current;
      pendingEditModeRef.current = null;
      loadedValue.setEditMode(desired);
    }
  }, [loadedValue]);

  const setDeferredEditMode = useCallback((enabled: boolean) => {
    pendingEditModeRef.current = enabled;
    setPendingEditMode(enabled);
  }, []);

  const defaultConfig = useMemo(() => getDefaultConfig(), []);
  const visibleFallbackConfig =
    remoteSyncStatus === 'ready' || remoteSyncStatus === 'bootstrapping'
      ? initialConfig
      : defaultConfig;
  const fallbackLoading =
    !loadFailed &&
    !remoteTableConfigDisabled &&
    (remoteSyncStatus === 'bootstrapping' || remoteSyncStatus === 'ready');

  const fallbackValue = useMemo<TableConfigContextType>(
    () => ({
      config: visibleFallbackConfig,
      isEditMode: pendingEditMode,
      isLoading: fallbackLoading,
      setEditMode: setDeferredEditMode,
      updateColumnWidth: noop,
      updatePageMargin: noop,
      resetToDefaults: noop,
      exportConfig: noop,
      importConfig: rejectedImport,
    }),
    [fallbackLoading, pendingEditMode, setDeferredEditMode, visibleFallbackConfig]
  );

  return (
    <TableConfigContext.Provider value={loadedValue ?? fallbackValue}>
      {Provider ? (
        <Provider>
          <TableConfigValueBridge onChange={setLoadedValue} />
        </Provider>
      ) : null}
      {children}
    </TableConfigContext.Provider>
  );
};
