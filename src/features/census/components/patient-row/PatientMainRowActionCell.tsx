import React from 'react';
import { LoaderCircle } from 'lucide-react';
import { PatientActionMenu } from './PatientActionMenu';
import type { PatientMainRowActionCellProps } from '@/features/census/components/patient-row/patientRowContracts';

export const PatientMainRowActionCell: React.FC<PatientMainRowActionCellProps> = ({
  isBlocked,
  readOnly,
  clinicalEditingDisabled,
  align,
  showCmaAction = true,
  accessProfile = 'default',
  hasPatientIdentity = true,
  hasClinicalDocument,
  isNewAdmission,
  onAction,
  onViewDemographics,
  onViewClinicalDocuments,
  onViewExamRequest,
  onViewImagingRequest,
  onViewMedicalIndications,
  onViewHistory,
  medicalIndicationsPatient,
  clinicalDocumentCount,
  isPendingClear = false,
}) => (
  <td className="p-0 text-center border-r border-slate-200 relative z-[36] w-10 overflow-visible print:hidden">
    {isPendingClear ? (
      <span
        className="inline-flex h-full min-h-8 w-full items-center justify-center text-amber-700"
        role="status"
        title="Confirmando limpieza…"
        aria-label="Confirmando limpieza de la cama"
      >
        <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
      </span>
    ) : (
      <PatientActionMenu
        isBlocked={isBlocked}
        onAction={onAction}
        onViewDemographics={onViewDemographics}
        onViewClinicalDocuments={onViewClinicalDocuments}
        onViewExamRequest={onViewExamRequest}
        onViewImagingRequest={onViewImagingRequest}
        onViewMedicalIndications={onViewMedicalIndications}
        onViewHistory={onViewHistory}
        readOnly={readOnly}
        clinicalEditingDisabled={clinicalEditingDisabled}
        accessProfile={accessProfile}
        hasPatientIdentity={hasPatientIdentity}
        align={align}
        showCmaAction={showCmaAction}
        hasClinicalDocument={hasClinicalDocument}
        isNewAdmission={isNewAdmission}
        medicalIndicationsPatient={medicalIndicationsPatient}
        clinicalDocumentCount={clinicalDocumentCount}
      />
    )}
  </td>
);
