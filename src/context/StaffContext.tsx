/**
 * StaffContext
 * Manages state for nursing and TENS staff assignment.
 * Now integrated with TanStack Query for data fetching and sync.
 */

import React, { createContext, useContext, useMemo, useState, ReactNode } from 'react';
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
    data: nurses = [],
    isLoading: nursesLoading,
    identities: staffIdentities = NO_STAFF_IDENTITIES,
  } = useNursesQuery();
  const staffUsage = useStaffUsage(staffIdentities);
  const { data: tens = [], isLoading: tensLoading } = useTensQuery();
  const { data: professionals = [], isLoading: professionalsLoading } = useProfessionalsQuery();
  const reconciledNurses = useMemo(() => reconcileNurseCatalogNames(nurses), [nurses]);

  // 2. Mutations for saving
  const saveNursesMutation = useSaveNursesMutation();
  const saveTensMutation = useSaveTensMutation();
  const saveProfessionalsMutation = useSaveProfessionalsMutation();

  // 3. Manager modal visibility state
  const [showNurseManager, setShowNurseManager] = useState(false);
  const [showTensManager, setShowTensManager] = useState(false);

  // Compatibility setters (now trigger mutations)
  const setNursesList = (updatedNurses: string[]) => {
    saveNursesMutation.mutate(reconcileNurseCatalogNames(updatedNurses));
  };

  const setTensList = (updatedTens: string[]) => {
    saveTensMutation.mutate(updatedTens);
  };

  const setProfessionalsCatalog = (updatedProfessionals: ProfessionalCatalogItem[]) => {
    saveProfessionalsMutation.mutate(updatedProfessionals);
  };

  const value: StaffContextType = {
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
  };

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
