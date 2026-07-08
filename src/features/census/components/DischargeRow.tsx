import React, { Suspense, lazy, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import { resolveDischargeRowViewModel } from '@/features/census/controllers/dischargeRowViewController';
import { DischargeRowView } from '@/features/census/components/DischargeRowView';
import { buildDischargeClinicalDocumentsPatientSnapshot } from '@/features/census/controllers/movementClinicalDocumentsController';

const LazyClinicalDocumentsModal = lazy(() =>
  import('@/features/clinical-documents').then(module => ({
    default: module.ClinicalDocumentsModal,
  }))
);

interface DischargeRowProps {
  item: DischargeData;
  recordDate: string;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: DischargeData) => void;
  onUpdate: (item: DischargeData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConvertToCma: (id: string) => Promise<void>;
}

export const DischargeRow: React.FC<DischargeRowProps> = React.memo(
  ({ item, recordDate, onUndo, onEdit, onUpdate, onDelete, onConvertToCma }) => {
    const [showClinicalDocuments, setShowClinicalDocuments] = useState(false);
    const clinicalDocumentsPatient = useMemo(
      () => buildDischargeClinicalDocumentsPatientSnapshot(item, recordDate),
      [item, recordDate]
    );
    const viewModel = resolveDischargeRowViewModel(item, {
      undoDischarge: onUndo,
      viewClinicalDocuments: () => setShowClinicalDocuments(true),
      editDischarge: onEdit,
      deleteDischarge: onDelete,
      convertDischargeToCma: onConvertToCma,
    });

    return (
      <>
        <DischargeRowView
          viewModel={viewModel}
          recordDate={recordDate}
          dischargeItem={item}
          onUpdateDischarge={onUpdate}
        />
        {showClinicalDocuments &&
          createPortal(
            <Suspense fallback={null}>
              <LazyClinicalDocumentsModal
                isOpen={showClinicalDocuments}
                onClose={() => setShowClinicalDocuments(false)}
                patient={clinicalDocumentsPatient}
                currentDateString={item.movementDate || recordDate}
                bedId={clinicalDocumentsPatient.bedId || item.bedId}
              />
            </Suspense>,
            document.body
          )}
      </>
    );
  }
);

DischargeRow.displayName = 'DischargeRow';
