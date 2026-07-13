import React from 'react';
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
}) => (
  <td className="p-0 text-center border-r border-slate-200 relative z-[36] w-10 overflow-visible print:hidden">
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
  </td>
);
