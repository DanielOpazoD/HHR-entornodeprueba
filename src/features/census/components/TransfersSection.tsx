import React from 'react';

import { useDailyRecordMovementActions } from '@/context/DailyRecordContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { ArrowRightLeft } from 'lucide-react';
import { TRANSFERS_TABLE_HEADERS } from '@/features/census/controllers/censusTransfersTableController';
import { resolveTransfersSectionState } from '@/features/census/controllers/censusTransfersSectionController';
import {
  TRANSFER_DELETE_CONFIRM_DIALOG,
  TRANSFER_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';
import { CensusMovementSectionLayout } from '@/features/census/components/CensusMovementSectionLayout';
import { TransferRow } from '@/features/census/components/TransferRow';
import { useMovementSectionActions } from '@/features/census/hooks/useMovementSectionActions';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';

// Interface for props removed as data comes from context

export const TransfersSection: React.FC = () => {
  const { recordDate, transfers } = useCensusMovementData();
  const { undoTransfer, deleteTransfer } = useDailyRecordMovementActions();
  const { handleEditTransfer } = useCensusActionCommands();
  const { handleUndo, handleDelete } = useMovementSectionActions({
    undoDialog: TRANSFER_UNDO_CONFIRM_DIALOG,
    undoErrorTitle: 'No se pudo deshacer traslado',
    onUndo: undoTransfer,
    deleteDialog: TRANSFER_DELETE_CONFIRM_DIALOG,
    deleteErrorTitle: 'No se pudo eliminar traslado',
    onDelete: deleteTransfer,
  });
  const sectionState = resolveTransfersSectionState(transfers);

  if (!sectionState.isRenderable) return null;

  return (
    <CensusMovementSectionLayout
      title="Traslados"
      emptyMessage="No hay traslados registrados para hoy."
      icon={<ArrowRightLeft size={18} />}
      iconClassName="bg-blue-50 text-blue-600"
      isEmpty={sectionState.isEmpty}
      headers={TRANSFERS_TABLE_HEADERS}
    >
      {sectionState.transfers.map(item => (
        <TransferRow
          key={item.id}
          item={item}
          recordDate={recordDate}
          onUndo={handleUndo}
          onEdit={handleEditTransfer}
          onDelete={handleDelete}
        />
      ))}
    </CensusMovementSectionLayout>
  );
};
