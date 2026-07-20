import React, { Suspense, lazy, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import { resolveDischargeRowViewModel } from '@/features/census/controllers/dischargeRowViewController';
import { DischargeRowView } from '@/features/census/components/DischargeRowView';
import { buildDischargeClinicalDocumentsPatientSnapshot } from '@/features/census/controllers/movementClinicalDocumentsController';
import { PatientHospitalizationReportsDialog } from '@/features/census/components/PatientHospitalizationReportsDialog';

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
  onConvertToTransfer?: (id: string) => Promise<void>;
}

export const DischargeRow: React.FC<DischargeRowProps> = React.memo(
  ({
    item,
    recordDate,
    onUndo,
    onEdit,
    onUpdate,
    onDelete,
    onConvertToCma,
    onConvertToTransfer,
  }) => {
    const [showClinicalDocuments, setShowClinicalDocuments] = useState(false);
    const [showHospitalizationReports, setShowHospitalizationReports] = useState(false);
    const clinicalDocumentsPatient = useMemo(
      () => buildDischargeClinicalDocumentsPatientSnapshot(item, recordDate),
      [item, recordDate]
    );
    const viewModel = resolveDischargeRowViewModel(item, {
      undoDischarge: onUndo,
      viewClinicalDocuments: () => setShowClinicalDocuments(true),
      openHospitalizationReports: () => setShowHospitalizationReports(true),
      editDischarge: onEdit,
      deleteDischarge: onDelete,
      convertDischargeToCma: onConvertToCma,
      convertDischargeToTransfer: onConvertToTransfer,
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
        <PatientHospitalizationReportsDialog
          isOpen={showHospitalizationReports}
          onClose={() => setShowHospitalizationReports(false)}
          patientName={item.patientName}
          patientRun={item.rut}
          currentEpisodeId={item.clinicalEpisodeId}
          censusDate={item.movementDate || recordDate}
        />
      </>
    );
  }
);

DischargeRow.displayName = 'DischargeRow';
