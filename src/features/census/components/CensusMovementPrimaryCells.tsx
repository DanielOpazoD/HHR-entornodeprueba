import React from 'react';
import type { CensusMovementRowBaseViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import { CensusMovementPatientIdentity } from './CensusMovementPatientIdentity';

export const UNREPORTED_MOVEMENT_VALUE = (
  <span className="text-slate-500 italic">Sin informar</span>
);

interface CensusMovementPrimaryCellsProps {
  viewModel: Pick<
    CensusMovementRowBaseViewModel,
    'bedName' | 'bedType' | 'patientName' | 'rut' | 'admissionDate' | 'diagnosis'
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
    <CensusMovementPatientIdentity
      name={viewModel.patientName}
      identifier={viewModel.rut}
      admissionDate={viewModel.admissionDate}
    />
    <td className="p-2 text-slate-600">
      {viewModel.diagnosis.trim() ? viewModel.diagnosis : UNREPORTED_MOVEMENT_VALUE}
    </td>
  </>
);
