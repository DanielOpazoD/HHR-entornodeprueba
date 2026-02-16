import React from 'react';

import { useDailyRecordMovementActions } from '@/context/DailyRecordContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { ArrowRightLeft } from 'lucide-react';
import { TRANSFERS_TABLE_HEADERS } from '@/features/census/controllers/censusTransfersTableController';
import {
  TRANSFER_DELETE_CONFIRM_DIALOG,
  TRANSFER_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';
import { CensusMovementSection } from '@/features/census/components/CensusMovementSection';
import { TransferRow } from '@/features/census/components/TransferRow';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { useMovementSectionModel } from '@/features/census/hooks/useMovementSectionModel';

// Interface for props removed as data comes from context

export const TransfersSection: React.FC = () => {
  const { recordDate, transfers } = useCensusMovementData();
  const { undoTransfer, deleteTransfer } = useDailyRecordMovementActions();
  const { handleEditTransfer } = useCensusActionCommands();
  const sectionModel = useMovementSectionModel({
    items: transfers,
    undoDialog: TRANSFER_UNDO_CONFIRM_DIALOG,
    undoErrorTitle: 'No se pudo deshacer traslado',
    onUndo: undoTransfer,
    deleteDialog: TRANSFER_DELETE_CONFIRM_DIALOG,
    deleteErrorTitle: 'No se pudo eliminar traslado',
    onDelete: deleteTransfer,
  });

  return (
    <CensusMovementSection
      model={sectionModel}
      title="Traslados"
      emptyMessage="No hay traslados registrados para hoy."
      icon={<ArrowRightLeft size={18} />}
      iconClassName="bg-blue-50 text-blue-600"
      headers={TRANSFERS_TABLE_HEADERS}
      getItemKey={item => item.id}
      renderRow={item => (
        <TransferRow
          item={item}
          recordDate={recordDate}
          onUndo={sectionModel.handleUndo}
          onEdit={handleEditTransfer}
          onDelete={sectionModel.handleDelete}
        />
      )}
    ></CensusMovementSection>
  );
};
