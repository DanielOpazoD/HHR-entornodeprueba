import React, { Suspense, lazy, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText } from 'lucide-react';
import { CensusMovementPrimaryCells } from '@/features/census/components/CensusMovementPrimaryCells';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';
import type { TransferRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import type { TransferData } from '@/features/census/contracts/censusMovementContracts';

const LazyIEEHFormDialog = lazy(() =>
  import('@/features/census/components/IEEHFormDialog').then(module => ({
    default: module.IEEHFormDialog,
  }))
);

interface TransferRowViewProps {
  viewModel: TransferRowViewModel;
  recordDate: string;
  transferItem?: TransferData;
}

export const TransferRowView: React.FC<TransferRowViewProps> = ({
  viewModel,
  recordDate,
  transferItem,
}) => {
  const [showDialog, setShowDialog] = useState(false);

  return (
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
        actionsPresentation="menu"
      >
        {transferItem?.originalData && (
          <button
            type="button"
            onClick={() => setShowDialog(true)}
            title="Generar Informe Estadístico de Egreso (IEEH)"
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 hover:border-emerald-300 transition-colors h-7"
          >
            <FileText size={12} />
            IEEH
          </button>
        )}
      </CensusMovementDateActionsCells>

      {showDialog &&
        transferItem?.originalData &&
        createPortal(
          <Suspense fallback={null}>
            <LazyIEEHFormDialog
              isOpen={showDialog}
              onClose={() => setShowDialog(false)}
              patient={transferItem.originalData}
              baseDischargeData={{
                dischargeDate: transferItem.movementDate || recordDate,
                dischargeTime: transferItem.time,
              }}
            />
          </Suspense>,
          document.body
        )}
    </tr>
  );
};
