import React, { useState } from 'react';

import type { TransferData } from '@/features/census/contracts/censusMovementContracts';
import { resolveTransferRowViewModel } from '@/features/census/controllers/transferRowViewController';
import { TransferRowView } from '@/features/census/components/TransferRowView';
import { PatientHospitalizationReportsDialog } from './PatientHospitalizationReportsDialog';
import { resolveMovementHistoricalAdmissionDate } from '@/types/domain/movements';

interface TransferRowProps {
  item: TransferData;
  recordDate: string;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: TransferData) => void;
  onDelete: (id: string) => Promise<void>;
  onConvertToHomeDischarge?: (id: string) => Promise<void>;
  onConvertToCma?: (id: string) => Promise<void>;
}

export const TransferRow: React.FC<TransferRowProps> = React.memo(
  ({ item, recordDate, onUndo, onEdit, onDelete, onConvertToHomeDischarge, onConvertToCma }) => {
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
          recordDate={recordDate}
          onOpenEpicrisis={() => setShowHospitalizationReports(true)}
        />
        {showHospitalizationReports && (
          <PatientHospitalizationReportsDialog
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
