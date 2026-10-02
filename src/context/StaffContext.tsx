/**
 * StaffContext
 * Manages state for nursing and TENS staff assignment.
 * Now integrated with TanStack Query for data fetching and sync.
 */

import React, { createContext, useContext, useCallback, useMemo, useState, ReactNode } from 'react';
import {
  useNursesQuery,
  useTensQuery,
  useSaveNursesMutation,
  useSaveTensMutation,
  useProfessionalsQuery,
  useSaveProfessionalsMutation,
} from '@/hooks/useStaffQuery';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { reconcileNurseCatalogNames } from '@/services/staff/nurseIdentity';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { useStaffUsage } from '@/hooks/useStaffUsage';
import type { StaffUsage } from '@/services/staff/staffUsage';

const NO_STAFF_NAMES: string[] = [];
const NO_PROFESSIONALS: ProfessionalCatalogItem[] = [];
const NO_STAFF_IDENTITIES: EloisaStaffIdentity[] = [];

// ============================================================================
// Types
// ============================================================================

export interface StaffContextType {
  staffIdentities?: EloisaStaffIdentity[];
  staffUsage?: StaffUsage;
  // Nurse catalog (available names)
  nursesList: string[];
  setNursesList: (nurses: string[]) => void;
  nursesLoading: boolean;

  // TENS catalog (available names)
  tensList: string[];
  setTensList: (tens: string[]) => void;
  tensLoading: boolean;

  // Professionals catalog
  professionalsCatalog: ProfessionalCatalogItem[];
  setProfessionalsCatalog: (professionals: ProfessionalCatalogItem[]) => void;
  professionalsLoading: boolean;

  // Manager modal visibility
  showNurseManager: boolean;
  setShowNurseManager: (show: boolean) => void;
  showTensManager: boolean;
  setShowTensManager: (show: boolean) => void;
}

const StaffContext = createContext<StaffContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface StaffProviderProps {
  children: ReactNode;
}

export const StaffProvider: React.FC<StaffProviderProps> = ({ children }) => {
  // 1. Data Fetching via TanStack Query
  const {
    data: nurses = NO_STAFF_NAMES,
    isLoading: nursesLoading,
    identities: staffIdentities = NO_STAFF_IDENTITIES,
  } = useNursesQuery();
  const staffUsage = useStaffUsage(staffIdentities);
  const { data: tens = NO_STAFF_NAMES, isLoading: tensLoading } = useTensQuery();
  const { data: professionals = NO_PROFESSIONALS, isLoading: professionalsLoading } =
    useProfessionalsQuery();
  const reconciledNurses = useMemo(() => reconcileNurseCatalogNames(nurses), [nurses]);

  // 2. Mutations for saving
  const { mutate: saveNurses } = useSaveNursesMutation();
  const { mutate: saveTens } = useSaveTensMutation();
  const { mutate: saveProfessionals } = useSaveProfessionalsMutation();

  // 3. Manager modal visibility state
  const [showNurseManager, setShowNurseManager] = useState(false);
  const [showTensManager, setShowTensManager] = useState(false);

  // Compatibility setters (now trigger mutations)
  const setNursesList = useCallback(
    (updatedNurses: string[]) => {
      saveNurses(reconcileNurseCatalogNames(updatedNurses));
    },
    [saveNurses]
  );

  const setTensList = useCallback(
    (updatedTens: string[]) => {
      saveTens(updatedTens);
    },
    [saveTens]
  );

  const setProfessionalsCatalog = useCallback(
    (updatedProfessionals: ProfessionalCatalogItem[]) => {
      saveProfessionals(updatedProfessionals);
    },
    [saveProfessionals]
  );

  const value = useMemo<StaffContextType>(
    () => ({
      staffIdentities,
      staffUsage,
      nursesList: reconciledNurses,
      setNursesList,
      nursesLoading,
      tensList: tens,
      setTensList,
      tensLoading,
      professionalsCatalog: professionals,
      setProfessionalsCatalog,
      professionalsLoading,
      showNurseManager,
      setShowNurseManager,
      showTensManager,
      setShowTensManager,
    }),
    [
      staffIdentities,
      staffUsage,
      reconciledNurses,
      setNursesList,
      nursesLoading,
      tens,
      setTensList,
      tensLoading,
      professionals,
      setProfessionalsCatalog,
      professionalsLoading,
      showNurseManager,
      showTensManager,
    ]
  );

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
};

export const StaffContextProvider = StaffContext.Provider;

// ============================================================================
// Hook
// ============================================================================

export const useStaffContext = () => {
  const context = useContext(StaffContext);
  if (!context) {
    throw new Error('useStaffContext must be used within a StaffProvider');
  }
  return context;
};
