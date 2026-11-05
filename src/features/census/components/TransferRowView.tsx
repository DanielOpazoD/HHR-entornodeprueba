import { TransferInlineField } from './TransferInlineField';
import { EVACUATION_METHODS, RECEIVING_CENTERS } from '@/constants/clinicalMovementConstants';
import React from 'react';
import {
  CensusMovementPrimaryCells,
  UNREPORTED_MOVEMENT_VALUE,
} from '@/features/census/components/CensusMovementPrimaryCells';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';
import type { TransferRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import { CensusMovementEpicrisisButton } from './CensusMovementEpicrisisButton';
interface TransferRowViewProps {
  viewModel: TransferRowViewModel;
  recordDate: string;
  onSaveField?: (field: 'method' | 'center', value: string) => Promise<boolean>;
  onOpenEpicrisis?: () => void;
}

export const TransferRowView: React.FC<TransferRowViewProps> = ({
  viewModel,
  recordDate,
  onSaveField,
  onOpenEpicrisis,
}) => (
  <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
    <CensusMovementPrimaryCells viewModel={viewModel} showBedType={false} />
    <td className="p-2 text-slate-600">
      {onSaveField ? (
        <TransferInlineField
          label="Medio de traslado"
          value={viewModel.evacuationMethodLabel}
          options={EVACUATION_METHODS.filter(value => value !== 'Otro')}
          onSave={value => onSaveField('method', value)}
        />
      ) : (
        viewModel.evacuationMethodLabel.trim() || UNREPORTED_MOVEMENT_VALUE
      )}
    </td>
    <td className="p-2 text-slate-600">
      <div>
        {onSaveField ? (
          <TransferInlineField
            label="Centro destino"
            value={viewModel.receivingCenterLabel}
            options={RECEIVING_CENTERS.filter(
              value => value !== 'Otro' && value !== 'Extrasistema'
            )}
            onSave={value => onSaveField('center', value)}
          />
        ) : (
          viewModel.receivingCenterLabel.trim() || UNREPORTED_MOVEMENT_VALUE
        )}
      </div>
      {viewModel.transferEscortLabel && (
        <div className="mt-0.5 text-[10px] italic text-slate-400">
          {viewModel.transferEscortLabel}
        </div>
      )}
    </td>
    <CensusMovementDateActionsCells
      context={viewModel}
      recordDate={recordDate}
      movementDate={viewModel.movementDate}
      movementTime={viewModel.movementTime}
      movementProvenance={viewModel.movementProvenance}
      actions={viewModel.actions}
    >
      {onOpenEpicrisis && (
        <CensusMovementEpicrisisButton
          patientName={viewModel.patientName}
          onClick={onOpenEpicrisis}
        />
      )}
    </CensusMovementDateActionsCells>
  </tr>
);
