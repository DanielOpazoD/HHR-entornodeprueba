import { CatalogConflictError } from '@/services/repositories/contracts/catalogChanges';
import React from 'react';
import { CatalogRemoteSyncError } from '@/services/repositories/contracts/catalogContracts';
import {
  CatalogReadUnavailableError,
  useTensQuery,
  useSaveTensMutation,
} from '@/hooks/useStaffQuery';
import { StaffCatalogManagerModal } from '@/components/modals/StaffCatalogManagerModal';

interface TensManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tensList: string[];
}

export const TensManagerModal: React.FC<TensManagerModalProps> = ({
  isOpen,
  onClose,
  tensList,
}) => {
  const mutation = useSaveTensMutation();
  const query = useTensQuery();
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
      staffList={tensList}
      savedList={query.manualData}
      onSave={save}
      syncing={mutation.isPending}
      hasSyncError={mutation.error instanceof CatalogRemoteSyncError}
      saveError={saveError}
      onRetry={mutation.error instanceof CatalogReadUnavailableError ? retry : undefined}
      variant="tens"
    />
  );
};
