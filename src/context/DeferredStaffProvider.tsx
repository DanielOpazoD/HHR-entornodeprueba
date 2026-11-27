/**
 * DeferredStaffProvider
 * Publishes `StaffContext` immediately on first render without remounting children,
 * while loading the catalog runtime (`StaffProvider`) asynchronously in its own
 * precached offline chunk outside `app-authenticated-shell`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StaffContext, useStaffContext, type StaffContextType } from './StaffContext';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

export type StaffProviderComponent = React.ComponentType<{ children: ReactNode }>;

const EMPTY_NAMES: string[] = [];
const EMPTY_PROFESSIONALS: ProfessionalCatalogItem[] = [];
const EMPTY_IDENTITIES: EloisaStaffIdentity[] = [];
const noop = () => undefined;

export const loadStaffProvider = async (): Promise<StaffProviderComponent> => {
  const module = await import('@/context/StaffProvider');
  return module.StaffProvider;
};

// Publish the deferred runtime through a sibling bridge so the outer provider stays
// mounted from render 0 and never remounts the census tree when the chunk resolves.
const StaffValueBridge: React.FC<{ onChange: (value: StaffContextType) => void }> = ({
  onChange,
}) => {
  const value = useStaffContext();
  useEffect(() => {
    onChange(value);
  }, [onChange, value]);
  return null;
};

interface DeferredStaffProviderProps {
  children: ReactNode;
  loader?: () => Promise<StaffProviderComponent>;
}

export const DeferredStaffProvider: React.FC<DeferredStaffProviderProps> = ({
  children,
  loader = loadStaffProvider,
}) => {
  const [Provider, setProvider] = useState<StaffProviderComponent | null>(null);
  const [loadedValue, setLoadedValue] = useState<StaffContextType | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [pendingShowNurseManager, setPendingShowNurseManager] = useState(false);
  const [pendingShowTensManager, setPendingShowTensManager] = useState(false);
  const pendingNurseManagerRef = useRef<boolean | null>(null);
  const pendingTensManagerRef = useRef<boolean | null>(null);

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
        // SAVE-01: never present a failed staff runtime load as an empty loaded catalog.
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [Provider, loadAttempt, loader]);

  useEffect(() => {
    if (!loadedValue) return;
    if (pendingNurseManagerRef.current !== null) {
      const desired = pendingNurseManagerRef.current;
      pendingNurseManagerRef.current = null;
      loadedValue.setShowNurseManager(desired);
    }
    if (pendingTensManagerRef.current !== null) {
      const desired = pendingTensManagerRef.current;
      pendingTensManagerRef.current = null;
      loadedValue.setShowTensManager(desired);
    }
  }, [loadedValue]);

  const setDeferredShowNurseManager = useCallback((show: boolean) => {
    pendingNurseManagerRef.current = show;
    setPendingShowNurseManager(show);
  }, []);

  const setDeferredShowTensManager = useCallback((show: boolean) => {
    pendingTensManagerRef.current = show;
    setPendingShowTensManager(show);
  }, []);

  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    setLoadAttempt(attempt => attempt + 1);
  }, []);

  const fallbackValue = useMemo<StaffContextType>(
    () => ({
      staffIdentities: EMPTY_IDENTITIES,
      nursesList: EMPTY_NAMES,
      setNursesList: noop,
      nursesLoading: !loadFailed,
      nursesCatalogUnavailable: loadFailed,
      retryNursesCatalog: retryLoad,
      tensList: EMPTY_NAMES,
      setTensList: noop,
      tensLoading: !loadFailed,
      tensCatalogUnavailable: loadFailed,
      retryTensCatalog: retryLoad,
      professionalsCatalog: EMPTY_PROFESSIONALS,
      setProfessionalsCatalog: noop,
      professionalsLoading: !loadFailed,
      showNurseManager: pendingShowNurseManager,
      setShowNurseManager: setDeferredShowNurseManager,
      showTensManager: pendingShowTensManager,
      setShowTensManager: setDeferredShowTensManager,
    }),
    [
      loadFailed,
      pendingShowNurseManager,
      pendingShowTensManager,
      retryLoad,
      setDeferredShowNurseManager,
      setDeferredShowTensManager,
    ]
  );

  const providerBridge = useMemo(
    () =>
      Provider ? (
        <Provider>
          <StaffValueBridge onChange={setLoadedValue} />
        </Provider>
      ) : null,
    [Provider]
  );

  return (
    <StaffContext.Provider value={loadedValue ?? fallbackValue}>
      {providerBridge}
      {children}
    </StaffContext.Provider>
  );
};
