import React, { Suspense, lazy, useState } from 'react';
import clsx from 'clsx';
import { CensusMovementPrimaryCells } from '@/features/census/components/CensusMovementPrimaryCells';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import { MailWarning } from 'lucide-react';

const LazyFugaNotificationModal = lazy(() =>
  import('@/features/census/components/FugaNotificationModal').then(module => ({
    default: module.FugaNotificationModal,
  }))
);
interface DischargeRowViewProps {
  viewModel: DischargeRowViewModel;
  recordDate: string;
  dischargeItem?: DischargeData;
}

export const DischargeRowView: React.FC<DischargeRowViewProps> = ({
  viewModel,
  recordDate,
  dischargeItem,
}) => {
  const [showFugaNotificationModal, setShowFugaNotificationModal] = useState(false);

  const isFugaDischarge = dischargeItem?.dischargeType === 'Fuga';

  return (
    <>
      <tr
        className={clsx(
          'border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300',
          viewModel.isAssociatedClinicalCrib && 'bg-sky-50/40'
        )}
      >
        <CensusMovementPrimaryCells viewModel={viewModel} showBedType={false} />
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
          movementProvenance={viewModel.movementProvenance}
          statisticalDischargeReport={
            viewModel.movementProvenance?.source === 'gestion_camas' &&
            /^\d+$/.test(dischargeItem?.clinicalEpisodeId || '')
              ? {
                  clinicalEpisodeId: dischargeItem?.clinicalEpisodeId || '',
                  patientName: viewModel.patientName,
                }
              : undefined
          }
          actions={viewModel.actions}
          actionsPresentation="menu"
        >
          {isFugaDischarge && dischargeItem && (
            <button
              type="button"
              onClick={() => setShowFugaNotificationModal(true)}
              title="Notificar fuga por correo"
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 hover:border-blue-300 transition-colors h-7"
            >
              <MailWarning size={12} />
              FUGA
            </button>
          )}
        </CensusMovementDateActionsCells>
      </tr>

      {dischargeItem && isFugaDischarge && (
        <Suspense fallback={null}>
          <LazyFugaNotificationModal
            isOpen={showFugaNotificationModal}
            onClose={() => setShowFugaNotificationModal(false)}
            dischargeItem={dischargeItem}
            recordDate={recordDate}
          />
        </Suspense>
      )}
    </>
  );
};
