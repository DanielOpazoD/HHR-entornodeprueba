import React from 'react';

import type { TransferData } from '@/types';
import { resolveTransferRowViewModel } from '@/features/census/controllers/transferRowViewController';
import { TransferRowView } from '@/features/census/components/TransferRowView';

interface TransferRowProps {
  item: TransferData;
  recordDate: string;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: TransferData) => void;
  onDelete: (id: string) => Promise<void>;
}

export const TransferRow: React.FC<TransferRowProps> = React.memo(
  ({ item, recordDate, onUndo, onEdit, onDelete }) => {
    const viewModel = resolveTransferRowViewModel(item, {
      undoTransfer: onUndo,
      editTransfer: onEdit,
      deleteTransfer: onDelete,
    });

    return <TransferRowView viewModel={viewModel} recordDate={recordDate} />;
  }
);

TransferRow.displayName = 'TransferRow';
