import React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { TRANSFERS_TABLE_HEADERS } from '@/features/census/controllers/censusTransfersTableController';
import { CensusMovementSection } from '@/features/census/components/CensusMovementSection';
import { TransferRow } from '@/features/census/components/TransferRow';
import { useTransfersSectionModel } from '@/features/census/hooks/useTransfersSectionModel';

// Interface for props removed as data comes from context

export const TransfersSection: React.FC = () => {
  const {
    recordDate,
    sectionModel,
    handleEditTransfer,
    handleConvertTransferToHomeDischarge,
    handleConvertTransferToCma,
  } = useTransfersSectionModel();

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
          onConvertToHomeDischarge={handleConvertTransferToHomeDischarge}
          onConvertToCma={handleConvertTransferToCma}
        />
      )}
    />
  );
};
