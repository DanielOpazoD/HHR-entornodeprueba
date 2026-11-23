import React, { Suspense, lazy, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { DischargeData } from '@/types/domain/movements';
import type { AccreditedEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import { isClinicalCribDischarge } from '@/domain/movements/movementTombstonePolicy';
import {
  buildDischargeRowActions,
  getDischargeStatusBadgeClassName,
} from '@/features/census/controllers/censusDischargesTableController';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import { DischargeRowView } from '@/features/census/components/DischargeRowView';
import { buildDischargeClinicalDocumentsPatientSnapshot } from '@/features/census/controllers/movementClinicalDocumentsController';
import { DeferredHospitalizationReportsDialog } from '@/features/census/components/DeferredHospitalizationReportsDialog';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';
import { resolveMovementHistoricalAdmissionDate } from '@/types/domain/movements';

const dischargeBedLabel = (item: DischargeData): string => {
  const name = normalizeCribDisplayText(item.bedName);
  if (!isClinicalCribDischarge(item)) return name;
  const physicalBed = name.replace(/\s*\(Cuna RN\)\s*$/i, '').replace(/^C-/i, '') || item.bedId;
  return `C-${physicalBed}`;
};

interface DischargeRowActionHandlers {
  undoDischarge: (id: string) => void | Promise<void>;
  viewClinicalDocuments: (discharge: DischargeData) => void | Promise<void>;
  openHospitalizationReports: (discharge: DischargeData) => void | Promise<void>;
  editDischarge: (discharge: DischargeData) => void | Promise<void>;
  deleteDischarge: (id: string) => void | Promise<void>;
  convertDischargeToCma: (id: string) => void | Promise<void>;
  convertDischargeToTransfer?: (id: string) => void | Promise<void>;
  markDischargeInvalid?: (
    discharge: DischargeData,
    clinicalEpisodeId: AccreditedEpisodeId
  ) => void | Promise<void>;
}

export const resolveDischargeRowViewModel = (
  item: DischargeData,
  handlers: DischargeRowActionHandlers
): DischargeRowViewModel => ({
  kind: 'discharge',
  id: item.id,
  bedName: dischargeBedLabel(item),
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  admissionDate: resolveMovementHistoricalAdmissionDate(item),
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  movementProvenance: item.movementProvenance,
  isAssociatedClinicalCrib: isClinicalCribDischarge(item),
  dischargeTypeLabel:
    item.isNested === true
      ? 'Alta asociada'
      : isClinicalCribDischarge(item)
        ? 'Alta en cuna'
        : item.dischargeType || '-',
  statusLabel: item.status,
  statusBadgeClassName: getDischargeStatusBadgeClassName(item.status),
  actions: buildDischargeRowActions(item, handlers),
});

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
  onDelete: (id: string) => Promise<void>;
  onConvertToCma: (id: string) => Promise<void>;
  onConvertToTransfer?: (id: string) => Promise<void>;
  onMarkInvalid?: (item: DischargeData, clinicalEpisodeId: AccreditedEpisodeId) => Promise<void>;
}

export const DischargeRow: React.FC<DischargeRowProps> = React.memo(
  ({
    item,
    recordDate,
    onUndo,
    onEdit,
    onDelete,
    onConvertToCma,
    onConvertToTransfer,
    onMarkInvalid,
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
      markDischargeInvalid: onMarkInvalid,
    });

    return (
      <>
        <DischargeRowView
          viewModel={viewModel}
          recordDate={recordDate}
          dischargeItem={item}
          onOpenEpicrisis={() => setShowHospitalizationReports(true)}
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
        <DeferredHospitalizationReportsDialog
          isOpen={showHospitalizationReports}
          onClose={() => setShowHospitalizationReports(false)}
          patientName={item.patientName}
          patientRun={item.rut}
          currentEpisodeId={item.clinicalEpisodeId}
          admissionDate={resolveMovementHistoricalAdmissionDate(item)}
          censusDate={item.movementDate || recordDate}
        />
      </>
    );
  }
);

DischargeRow.displayName = 'DischargeRow';
