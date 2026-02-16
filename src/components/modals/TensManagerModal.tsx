import React from 'react';
import { useSaveTensMutation } from '@/hooks/useStaffQuery';
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
  const { mutate: saveTens, isPending: syncing, isError: hasSyncError } = useSaveTensMutation();

  return (
    <StaffCatalogManagerModal
      isOpen={isOpen}
      onClose={onClose}
      staffList={tensList}
      onSave={saveTens}
      syncing={syncing}
      hasSyncError={hasSyncError}
      variant="tens"
    />
  );
};
