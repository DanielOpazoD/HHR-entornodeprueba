/**
 * StaffContext
 * Lightweight context contract and consumer hook for nursing, TENS, and
 * treating-physician catalogs. The runtime provider lives in `StaffProvider.tsx`
 * so catalog query and storage modules stay outside `app-authenticated-shell`.
 */

import { createContext, useContext } from 'react';
import type { SavedStaffCatalog } from '@/services/repositories/contracts/catalogChanges';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import type { StaffUsage } from '@/services/staff/staffUsage';

export interface StaffContextType {
  staffIdentities?: EloisaStaffIdentity[];
  staffUsage?: StaffUsage;
  // Nurse catalog (available names)
  nursesList: string[];
  /** The saved list behind `nursesList`, from the same source as the shown names. */
  nursesSaved?: SavedStaffCatalog;
  setNursesList: (nurses: string[]) => void;
  nursesLoading: boolean;
  nursesCatalogUnavailable?: boolean;
  retryNursesCatalog?: () => void;

  // TENS catalog (available names)
  tensList: string[];
  /** The saved list behind `tensList`, from the same source as the shown names. */
  tensSaved?: SavedStaffCatalog;
  setTensList: (tens: string[]) => void;
  tensLoading: boolean;
  tensCatalogUnavailable?: boolean;
  retryTensCatalog?: () => void;

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

export const StaffContext = createContext<StaffContextType | undefined>(undefined);

export const useStaffContext = (): StaffContextType => {
  const context = useContext(StaffContext);
  if (!context) {
    throw new Error('useStaffContext must be used within a StaffProvider');
  }
  return context;
};
