import type { UpdateTransferAction } from '@/types/movements';
import React, { useState } from 'react';

import type { TransferData } from '@/types/domain/movements';
import {
  buildTransferRowActions,
  getTransferCenterLabel,
  getTransferEscortLabel,
} from '@/features/census/controllers/censusTransfersTableController';
import type { TransferRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import { TransferRowView } from '@/features/census/components/TransferRowView';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';
import { DeferredHospitalizationReportsDialog } from './DeferredHospitalizationReportsDialog';
import { resolveMovementHistoricalAdmissionDate } from '@/types/domain/movements';

interface TransferRowActionHandlers {
  undoTransfer: (id: string) => void | Promise<void>;
  editTransfer: (transfer: TransferData) => void | Promise<void>;
  deleteTransfer: (id: string) => void | Promise<void>;
  convertTransferToHomeDischarge?: (id: string) => void | Promise<void>;
  convertTransferToCma?: (id: string) => void | Promise<void>;
}

export const resolveTransferRowViewModel = (
  item: TransferData,
  handlers: TransferRowActionHandlers
): TransferRowViewModel => ({
  kind: 'transfer',
  id: item.id,
  bedName: normalizeCribDisplayText(item.bedName),
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  admissionDate: resolveMovementHistoricalAdmissionDate(item),
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  movementProvenance: item.movementProvenance,
  evacuationMethodLabel:
    item.evacuationMethod === 'Otro' ? item.evacuationMethodOther || '' : item.evacuationMethod,
  receivingCenterLabel: getTransferCenterLabel(item),
  transferEscortLabel: getTransferEscortLabel(item),
  actions: buildTransferRowActions(item, handlers),
});

interface TransferRowProps {
  item: TransferData;
  recordDate: string;
  onUpdate?: UpdateTransferAction;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: TransferData) => void;
  onDelete: (id: string) => Promise<void>;
  onConvertToHomeDischarge?: (id: string) => Promise<void>;
  onConvertToCma?: (id: string) => Promise<void>;
}

export const TransferRow: React.FC<TransferRowProps> = React.memo(
  ({
    item,
    recordDate,
    onUpdate,
    onUndo,
    onEdit,
    onDelete,
    onConvertToHomeDischarge,
    onConvertToCma,
  }) => {
    const [showHospitalizationReports, setShowHospitalizationReports] = useState(false);
    const viewModel = resolveTransferRowViewModel(item, {
      undoTransfer: onUndo,
      editTransfer: onEdit,
      deleteTransfer: onDelete,
      convertTransferToHomeDischarge: onConvertToHomeDischarge,
      convertTransferToCma: onConvertToCma,
    });

    return (
      <>
        <TransferRowView
          viewModel={viewModel}
          clinicalEpisodeId={item.clinicalEpisodeId}
          onSaveField={
            onUpdate
              ? async (field, value) => {
                  if (/^(otro|extrasistema)$/i.test(value.trim())) return false;
                  const updates =
                    field === 'method'
                      ? { evacuationMethod: value, evacuationMethodOther: '' }
                      : { receivingCenter: value, receivingCenterOther: '' };
                  return (await onUpdate(item.id, updates)) === true;
                }
              : undefined
          }
          recordDate={recordDate}
          onOpenEpicrisis={() => setShowHospitalizationReports(true)}
        />
        {showHospitalizationReports && (
          <DeferredHospitalizationReportsDialog
            isOpen={showHospitalizationReports}
            onClose={() => setShowHospitalizationReports(false)}
            patientName={item.patientName}
            patientRun={item.rut}
            currentEpisodeId={item.clinicalEpisodeId}
            admissionDate={resolveMovementHistoricalAdmissionDate(item)}
            censusDate={item.movementDate || recordDate}
          />
        )}
      </>
    );
  }
);

TransferRow.displayName = 'TransferRow';
