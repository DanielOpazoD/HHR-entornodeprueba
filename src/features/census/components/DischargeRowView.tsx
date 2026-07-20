import React, { Suspense, lazy, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { CensusMovementPrimaryCells } from '@/features/census/components/CensusMovementPrimaryCells';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import { FileText, MailWarning } from 'lucide-react';

const LazyFugaNotificationModal = lazy(() =>
  import('@/features/census/components/FugaNotificationModal').then(module => ({
    default: module.FugaNotificationModal,
  }))
);
const LazyIEEHFormDialog = lazy(() =>
  import('@/features/census/components/IEEHFormDialog').then(module => ({
    default: module.IEEHFormDialog,
  }))
);

interface DischargeRowViewProps {
  viewModel: DischargeRowViewModel;
  recordDate: string;
  dischargeItem?: DischargeData;
  onUpdateDischarge?: (updatedItem: DischargeData) => void;
}

export const DischargeRowView: React.FC<DischargeRowViewProps> = ({
  viewModel,
  recordDate,
  dischargeItem,
  onUpdateDischarge,
}) => {
  const [showDialog, setShowDialog] = useState(false);
  const [showFugaNotificationModal, setShowFugaNotificationModal] = useState(false);

  const isFugaDischarge = dischargeItem?.dischargeType === 'Fuga';

  return (
    <>
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
          {/* IEEH PDF Button aligned with actions */}
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
          {dischargeItem?.originalData && (
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

        {/* Dialog rendered via Portal at body level to avoid table clipping */}
        {showDialog &&
          dischargeItem?.originalData &&
          createPortal(
            <Suspense fallback={null}>
              <LazyIEEHFormDialog
                isOpen={showDialog}
                onClose={() => setShowDialog(false)}
                patient={dischargeItem.originalData}
                baseDischargeData={{
                  dischargeDate: dischargeItem.movementDate || recordDate,
                  dischargeTime: dischargeItem.time,
                }}
                savedIeehData={dischargeItem.ieehData}
                onSaveData={
                  onUpdateDischarge
                    ? ieehData => onUpdateDischarge({ ...dischargeItem, ieehData })
                    : undefined
                }
              />
            </Suspense>,
            document.body
          )}
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
