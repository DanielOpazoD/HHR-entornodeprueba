import React from 'react';
import { XRayIcon } from '@/components/ui/XRayIcon';

import { isValidRut } from '@/utils/rutUtils';
import type { PatientData } from './patientRowContracts';
import { ClinicalActionButton } from './ClinicalActionButton';

const RadiologyViewerModal = React.lazy(() =>
  import('@/components/modals/RadiologyViewerModal').then(module => ({
    default: module.RadiologyViewerModal,
  }))
);

const ImagingRequestDialog = React.lazy(() =>
  import('@/components/modals/ImagingRequestDialog').then(module => ({
    default: module.ImagingRequestDialog,
  }))
);

interface PatientRadiologyTriggerProps {
  patient: PatientData;
  triggerKey?: string;
}

interface OpenPatientRadiologySurface {
  kind: 'viewer' | 'request';
  patientIdentity: string;
}

export const PatientRadiologyTrigger: React.FC<PatientRadiologyTriggerProps> = ({
  patient,
  triggerKey = patient.bedId,
}) => {
  const [openSurface, setOpenSurface] = React.useState<OpenPatientRadiologySurface | null>(null);
  const patientName = patient.patientName.trim();
  const patientRut = patient.rut.trim();
  const patientIdentity = `${patientRut}:${patient.clinicalEpisodeId?.trim() ?? ''}`;
  const activeSurface = openSurface?.patientIdentity === patientIdentity ? openSurface.kind : null;

  React.useEffect(() => {
    setOpenSurface(current => (current?.patientIdentity === patientIdentity ? current : null));
  }, [patientIdentity]);

  if (
    !patientName ||
    !patientRut ||
    patientRut === '-' ||
    patient.documentType === 'Pasaporte' ||
    !isValidRut(patientRut)
  ) {
    return null;
  }

  const radiologyPatient = {
    bedId: patient.bedId,
    label: `${patient.bedId} · ${patientName}`,
    patientName,
    rut: patientRut,
    diagnosis: patient.pathology,
  };

  return (
    <>
      <span className="inline-flex shrink-0 items-center">
        <ClinicalActionButton
          tone="radiology"
          data-testid={`patient-radiology-trigger-${triggerKey}`}
          onClick={() => {
            setOpenSurface({ kind: 'viewer', patientIdentity });
          }}
          title="Radiología / Imagenología MMRAD"
          hint="Imagenología"
          label={`Abrir MMRAD de ${patientName}`}
        >
          <XRayIcon size={14} />
        </ClinicalActionButton>
      </span>

      {activeSurface === 'viewer' && (
        <React.Suspense fallback={null}>
          <RadiologyViewerModal
            isOpen
            onClose={() => setOpenSurface(null)}
            patients={[radiologyPatient]}
            initialPatientRut={patientRut}
            autoSearchInitialPatient
            onRequestImaging={() => setOpenSurface({ kind: 'request', patientIdentity })}
          />
        </React.Suspense>
      )}

      {activeSurface === 'request' && (
        <React.Suspense fallback={null}>
          <ImagingRequestDialog isOpen onClose={() => setOpenSurface(null)} patient={patient} />
        </React.Suspense>
      )}
    </>
  );
};
