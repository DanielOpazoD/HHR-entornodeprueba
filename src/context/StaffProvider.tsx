/**
 * StaffProvider
 * Runtime provider for nursing, TENS, and treating-physician catalogs.
 * Loaded lazily by DeferredStaffProvider so catalog query/storage/identity
 * modules stay out of the `app-authenticated-shell` startup chunk.
 */

import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { savedCatalogEdit } from '@/services/repositories/contracts/catalogChanges';
import {
  useNursesQuery,
  useTensQuery,
  useSaveNursesMutation,
  useSaveTensMutation,
  useProfessionalsQuery,
  useSaveProfessionalsMutation,
} from '@/hooks/useStaffQuery';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { formatNurseCatalogNames } from '@/services/staff/nurseIdentity';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { useStaffUsage } from '@/hooks/useStaffUsage';
import { StaffContext, type StaffContextType } from './StaffContext';

const NO_STAFF_NAMES: string[] = [];
const NO_PROFESSIONALS: ProfessionalCatalogItem[] = [];
const NO_STAFF_IDENTITIES: EloisaStaffIdentity[] = [];

interface StaffProviderProps {
  children: ReactNode;
}

export const StaffProvider: React.FC<StaffProviderProps> = ({ children }) => {
  // 1. Data Fetching via TanStack Query
  const {
    data: nurses = NO_STAFF_NAMES,
    isLoading: nursesLoading,
    isError: nursesReadError,
    refetch: refetchNurses,
    identities: staffIdentities = NO_STAFF_IDENTITIES,
    saved: nursesSaved,
  } = useNursesQuery();
  const staffUsage = useStaffUsage(staffIdentities);
  const {
    data: tens = NO_STAFF_NAMES,
    isLoading: tensLoading,
    isError: tensReadError,
    refetch: refetchTens,
    saved: tensSaved,
  } = useTensQuery();
  const { data: professionals = NO_PROFESSIONALS, isLoading: professionalsLoading } =
    useProfessionalsQuery();
  const reconciledNurses = useMemo(() => formatNurseCatalogNames(nurses), [nurses]);

  // 2. Mutations for saving
  const { mutate: saveNurses } = useSaveNursesMutation(nursesSaved?.person);
  const { mutate: saveTens } = useSaveTensMutation(tensSaved?.person);
  const { mutate: saveProfessionals } = useSaveProfessionalsMutation();

  // 3. Manager modal visibility state
  const [showNurseManager, setShowNurseManager] = useState(false);
  const [showTensManager, setShowTensManager] = useState(false);

  // Compatibility setters (now trigger mutations)
  const setNursesList = useCallback(
    (updatedNurses: string[]) => {
      saveNurses(
        savedCatalogEdit(nursesSaved, reconciledNurses, formatNurseCatalogNames(updatedNurses))
      );
    },
    [saveNurses, nursesSaved, reconciledNurses]
  );

  const setTensList = useCallback(
    (updatedTens: string[]) => {
      saveTens(savedCatalogEdit(tensSaved, tens, updatedTens));
    },
    [saveTens, tensSaved, tens]
  );

  const setProfessionalsCatalog = useCallback(
    (updatedProfessionals: ProfessionalCatalogItem[]) => {
      saveProfessionals({ next: updatedProfessionals, base: professionals });
    },
    [saveProfessionals, professionals]
  );

  const retryNursesCatalog = useCallback(() => {
    void refetchNurses();
  }, [refetchNurses]);

  const retryTensCatalog = useCallback(() => {
    void refetchTens();
  }, [refetchTens]);

  const value = useMemo<StaffContextType>(
    () => ({
      staffIdentities,
      staffUsage,
      nursesList: reconciledNurses,
      nursesSaved,
      setNursesList,
      nursesLoading,
      nursesCatalogUnavailable: nursesReadError && reconciledNurses.length === 0,
      retryNursesCatalog,
      tensList: tens,
      tensSaved,
      setTensList,
      tensLoading,
      tensCatalogUnavailable: tensReadError && tens.length === 0,
      retryTensCatalog,
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
      nursesSaved,
      setNursesList,
      nursesLoading,
      nursesReadError,
      retryNursesCatalog,
      tens,
      tensSaved,
      setTensList,
      tensLoading,
      tensReadError,
      retryTensCatalog,
      professionals,
      setProfessionalsCatalog,
      professionalsLoading,
      showNurseManager,
      showTensManager,
    ]
  );

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
};
