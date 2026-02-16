import React from 'react';
import { Lock } from 'lucide-react';
import { BEDS } from '@/constants';
import { useDailyRecordBedActions, useDailyRecordData } from '@/context/DailyRecordContext';
import { BaseModal, ModalSection } from '@/components/shared/BaseModal';
import { BedReasonDialog } from '@/components/modals/BedReasonDialog';
import { BlockedBedsGrid } from '@/components/modals/BlockedBedsGrid';
import { ExtraBedsGrid } from '@/components/modals/ExtraBedsGrid';
import {
  resolveBlockedBedsGridItems,
  resolveExtraBedsGridItems,
} from '@/features/census/controllers/bedManagerGridItemsController';
import { useBedManagerModalModel } from '@/features/census/hooks/useBedManagerModalModel';

interface BedManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BedManagerModal: React.FC<BedManagerModalProps> = ({ isOpen, onClose }) => {
  const { record } = useDailyRecordData();
  const { toggleBlockBed, updateBlockedReason, toggleExtraBed } = useDailyRecordBedActions();
  const {
    blockingBedId,
    editingBedId,
    reason,
    error,
    isAnyDialogOpen,
    isBlockingDialogOpen,
    handleBedClick,
    handleReasonChange,
    confirmBlock,
    cancelBlock,
    closeEditDialog,
    saveReason,
    unblockBed,
  } = useBedManagerModalModel({
    toggleBlockBed,
    updateBlockedReason,
  });

  if (!record) return null;

  const regularBeds = resolveBlockedBedsGridItems(BEDS, record.beds);
  const extraBeds = resolveExtraBedsGridItems(BEDS, record.activeExtraBeds);

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="Gestión de Camas"
        icon={<Lock size={18} />}
        size="md"
        variant="white"
        headerIconColor="text-amber-600"
      >
        <div className="space-y-4">
          <ModalSection
            title="Bloquear Camas"
            variant="warning"
            description="Seleccione una cama para bloquearla o editar su motivo de bloqueo."
          >
            <BlockedBedsGrid
              beds={regularBeds}
              disabled={isAnyDialogOpen}
              onBedClick={bed =>
                handleBedClick({
                  bedId: bed.id,
                  isBlocked: bed.isBlocked,
                  blockedReason: bed.blockedReason || '',
                })
              }
            />
          </ModalSection>

          <ModalSection
            title="Camas Extras"
            variant="info"
            description="Habilite camas adicionales temporalmente."
          >
            <ExtraBedsGrid
              beds={extraBeds}
              disabled={isBlockingDialogOpen}
              onToggleBed={toggleExtraBed}
            />
          </ModalSection>
        </div>
      </BaseModal>

      <BedReasonDialog
        isOpen={isBlockingDialogOpen}
        onClose={cancelBlock}
        title={`Bloquear Cama ${blockingBedId}`}
        headerIconColor="text-red-600"
        reason={reason}
        error={error}
        onReasonChange={handleReasonChange}
        onCancel={cancelBlock}
        onConfirm={confirmBlock}
        confirmLabel="Confirmar"
        confirmClassName="bg-red-600 shadow-lg shadow-red-600/20 hover:bg-red-700"
      />

      <BedReasonDialog
        isOpen={editingBedId !== null}
        onClose={closeEditDialog}
        title={`Editar Cama ${editingBedId}`}
        headerIconColor="text-amber-600"
        reason={reason}
        error={error}
        onReasonChange={handleReasonChange}
        onCancel={closeEditDialog}
        onConfirm={saveReason}
        confirmLabel="Guardar"
        confirmClassName="bg-amber-500 shadow-lg shadow-amber-500/20 hover:bg-amber-600"
        onDangerAction={unblockBed}
        dangerActionLabel="Desbloquear Cama"
      />
    </>
  );
};
