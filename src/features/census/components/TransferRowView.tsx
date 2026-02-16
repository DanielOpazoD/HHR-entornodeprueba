import React from 'react';
import { CensusMovementPrimaryCells } from '@/features/census/components/CensusMovementPrimaryCells';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';
import type { TransferRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';

interface TransferRowViewProps {
  viewModel: TransferRowViewModel;
  recordDate: string;
}

export const TransferRowView: React.FC<TransferRowViewProps> = ({ viewModel, recordDate }) => (
  <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
    <CensusMovementPrimaryCells viewModel={viewModel} />
    <td className="p-2 text-slate-600">{viewModel.evacuationMethodLabel}</td>
    <td className="p-2 text-slate-600">
      <div>{viewModel.receivingCenterLabel}</div>
      {viewModel.transferEscortLabel && (
        <div className="mt-0.5 text-[10px] italic text-slate-400">
          {viewModel.transferEscortLabel}
        </div>
      )}
    </td>
    <CensusMovementDateActionsCells
      recordDate={recordDate}
      movementDate={viewModel.movementDate}
      movementTime={viewModel.movementTime}
      actions={viewModel.actions}
    />
  </tr>
);
