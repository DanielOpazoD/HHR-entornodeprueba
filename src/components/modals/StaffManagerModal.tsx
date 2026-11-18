import {
  CatalogConflictError,
  type SavedStaffCatalog,
} from '@/services/repositories/contracts/catalogChanges';
import React from 'react';
import { CatalogRemoteSyncError } from '@/services/repositories/contracts/catalogContracts';
import {
  CatalogReadUnavailableError,
  useNursesQuery,
  useSaveNursesMutation,
  useSaveTensMutation,
  useTensQuery,
} from '@/hooks/useStaffQuery';
import { StaffCatalogManagerModal } from '@/components/modals/StaffCatalogManagerModal';
import type { NursingRole } from '@/services/staff/eloisaStaffIdentity';

/** Each role's catalog read and save; the role never changes for a mounted modal. */
const STAFF_CATALOG_HOOKS = {
  nurse: { useCatalogQuery: useNursesQuery, useSaveCatalog: useSaveNursesMutation },
  tens: { useCatalogQuery: useTensQuery, useSaveCatalog: useSaveTensMutation },
} as const satisfies Record<NursingRole, unknown>;

interface StaffManagerModalProps {
  role: NursingRole;
  isOpen: boolean;
  onClose: () => void;
  staffList: string[];
  /** The saved list behind `staffList`, from the same source. */
  saved?: SavedStaffCatalog;
}

export const StaffManagerModal: React.FC<StaffManagerModalProps> = ({
  role,
  isOpen,
  onClose,
  staffList,
  saved,
}) => {
  const { useCatalogQuery, useSaveCatalog } = STAFF_CATALOG_HOOKS[role];
  const mutation = useSaveCatalog();
  const query = useCatalogQuery();
  const save = async (names: string[], base?: string[]) => {
    try {
      await mutation.mutateAsync(base ? { next: names, base } : names);
      return true;
    } catch {
      return false;
    }
  };
  const retry = async () => {
    const result = await query.refetch();
    if (result.isSuccess) mutation.reset();
  };
  const saveError =
    mutation.error instanceof CatalogReadUnavailableError ||
    mutation.error instanceof CatalogConflictError
      ? mutation.error.message
      : mutation.isError && !(mutation.error instanceof CatalogRemoteSyncError)
        ? 'No se pudo guardar la lista. Lo escrito se conserva; vuelva a intentar guardar.'
        : undefined;

  return (
    <StaffCatalogManagerModal
      isOpen={isOpen}
      onClose={onClose}
      staffList={staffList}
      saved={saved}
      onSave={save}
      syncing={mutation.isPending}
      hasSyncError={mutation.error instanceof CatalogRemoteSyncError}
      saveError={saveError}
      onRetry={mutation.error instanceof CatalogReadUnavailableError ? retry : undefined}
      variant={role}
    />
  );
};
