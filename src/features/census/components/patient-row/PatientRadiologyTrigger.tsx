import React from 'react';
import { Radio } from 'lucide-react';

import { isValidRut } from '@/utils/rutUtils';
import type { PatientData } from './patientRowContracts';
import { ClinicalActionButton } from './ClinicalActionButton';

const RadiologyViewerModal = React.lazy(() =>
  import('@/components/modals/RadiologyViewerModal').then(module => ({
    default: module.RadiologyViewerModal,
  }))
);

interface PatientRadiologyTriggerProps {
  patient: PatientData;
  triggerKey?: string;
}

export const PatientRadiologyTrigger: React.FC<PatientRadiologyTriggerProps> = ({
  patient,
  triggerKey = patient.bedId,
}) => {
  const [openPatientIdentity, setOpenPatientIdentity] = React.useState<string | null>(null);
  const patientName = patient.patientName.trim();
  const patientRut = patient.rut.trim();
  const patientIdentity = `${patientRut}:${patient.clinicalEpisodeId?.trim() ?? ''}`;
  const isOpen = openPatientIdentity === patientIdentity;

  React.useEffect(() => {
    setOpenPatientIdentity(current => (current === patientIdentity ? current : null));
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
            setOpenPatientIdentity(patientIdentity);
          }}
          title="Radiología / Imagenología MMRAD"
          label={`Abrir MMRAD de ${patientName}`}
        >
          <Radio size={14} />
        </ClinicalActionButton>
      </span>

      {isOpen && (
        <React.Suspense fallback={null}>
          <RadiologyViewerModal
            isOpen
            onClose={() => setOpenPatientIdentity(null)}
            patients={[radiologyPatient]}
            initialPatientRut={patientRut}
            autoSearchInitialPatient
          />
        </React.Suspense>
      )}
    </>
  );
};
