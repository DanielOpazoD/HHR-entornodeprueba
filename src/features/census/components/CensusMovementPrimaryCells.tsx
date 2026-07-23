import React from 'react';
import type { CensusMovementRowBaseViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';

interface CensusMovementPrimaryCellsProps {
  viewModel: Pick<
    CensusMovementRowBaseViewModel,
    'bedName' | 'bedType' | 'patientName' | 'rut' | 'diagnosis'
  >;
  showBedType?: boolean;
}

export const CensusMovementPrimaryCells: React.FC<CensusMovementPrimaryCellsProps> = ({
  viewModel,
  showBedType = true,
}) => (
  <>
    <td className="p-2 font-medium text-slate-700">
      {viewModel.bedName}
      {showBedType ? (
        <span className="text-[10px] text-slate-400"> ({viewModel.bedType})</span>
      ) : null}
    </td>
    <td className="p-2 text-slate-800 font-medium">{viewModel.patientName}</td>
    <td className="p-2 font-mono text-xs text-slate-500">{viewModel.rut}</td>
    <td className="p-2 text-slate-600">{viewModel.diagnosis}</td>
  </>
);
