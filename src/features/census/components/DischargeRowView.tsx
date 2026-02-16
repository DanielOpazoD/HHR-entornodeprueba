import React from 'react';
import clsx from 'clsx';
import { CensusMovementPrimaryCells } from '@/features/census/components/CensusMovementPrimaryCells';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';

interface DischargeRowViewProps {
  viewModel: DischargeRowViewModel;
  recordDate: string;
}

export const DischargeRowView: React.FC<DischargeRowViewProps> = ({ viewModel, recordDate }) => (
  <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
    <CensusMovementPrimaryCells viewModel={viewModel} />
    <td className="p-2 text-xs text-slate-500">{viewModel.dischargeTypeLabel}</td>
    <td className="p-2">
      <span
        className={clsx(
          'rounded-full px-2 py-1 text-[11px] font-bold print:border print:border-slate-400',
          viewModel.statusBadgeClassName
        )}
      >
        {viewModel.statusLabel}
      </span>
    </td>
    <CensusMovementDateActionsCells
      recordDate={recordDate}
      movementDate={viewModel.movementDate}
      movementTime={viewModel.movementTime}
      actions={viewModel.actions}
    />
  </tr>
);
