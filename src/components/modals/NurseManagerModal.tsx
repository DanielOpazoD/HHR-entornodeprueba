import React from 'react';
import { useSaveNursesMutation } from '@/hooks/useStaffQuery';
import { StaffCatalogManagerModal } from '@/components/modals/StaffCatalogManagerModal';

interface NurseManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  nursesList: string[];
}

export const NurseManagerModal: React.FC<NurseManagerModalProps> = ({
  isOpen,
  onClose,
  nursesList,
}) => {
  const { mutate: saveNurses, isPending: syncing, isError: hasSyncError } = useSaveNursesMutation();

  return (
    <StaffCatalogManagerModal
      isOpen={isOpen}
      onClose={onClose}
      staffList={nursesList}
      onSave={saveNurses}
      syncing={syncing}
      hasSyncError={hasSyncError}
      variant="nurse"
    />
  );
};
