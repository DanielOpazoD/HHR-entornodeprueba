import type { UpdateTransferAction } from '@/types/movements';
import React, { useState } from 'react';

import type { TransferData } from '@/types/domain/movements';
import { resolveTransferRowViewModel } from '@/features/census/controllers/transferRowViewController';
import { TransferRowView } from '@/features/census/components/TransferRowView';
import { DeferredHospitalizationReportsDialog } from './DeferredHospitalizationReportsDialog';
import { resolveMovementHistoricalAdmissionDate } from '@/types/domain/movements';

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
