import React, { lazy } from 'react';
import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';
import { ClinicalDetailLoadBoundary } from './ClinicalDetailLoadBoundary';

const ClinicalAlertsModal = lazy(() =>
  import('./ClinicalAlertsModal').then(module => ({ default: module.ClinicalAlertsModal }))
);

/** Every chart alert of the patient, loaded on request; shared by the Scores cell and the view. */
export const ClinicalAlertsDetail: React.FC<{
  patientName: string;
  alerts: PatientClinicalAlert[];
  onClose: () => void;
}> = ({ patientName, alerts, onClose }) => (
  <ClinicalDetailLoadBoundary title={`Alertas de la ficha — ${patientName}`} onClose={onClose}>
    <ClinicalAlertsModal patientName={patientName} alerts={alerts} onClose={onClose} />
  </ClinicalDetailLoadBoundary>
);
