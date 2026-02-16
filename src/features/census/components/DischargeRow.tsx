import React from 'react';

import type { DischargeData } from '@/types';
import { resolveDischargeRowViewModel } from '@/features/census/controllers/dischargeRowViewController';
import { DischargeRowView } from '@/features/census/components/DischargeRowView';

interface DischargeRowProps {
  item: DischargeData;
  recordDate: string;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: DischargeData) => void;
  onDelete: (id: string) => Promise<void>;
}

export const DischargeRow: React.FC<DischargeRowProps> = React.memo(
  ({ item, recordDate, onUndo, onEdit, onDelete }) => {
    const viewModel = resolveDischargeRowViewModel(item, {
      undoDischarge: onUndo,
      editDischarge: onEdit,
      deleteDischarge: onDelete,
    });

    return <DischargeRowView viewModel={viewModel} recordDate={recordDate} />;
  }
);

DischargeRow.displayName = 'DischargeRow';
