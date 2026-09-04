import React from 'react';
import { Radio } from 'lucide-react';

import { isValidRut } from '@/utils/rutUtils';
import type { PatientData } from './patientRowContracts';

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
        <button
          type="button"
          data-testid={`patient-radiology-trigger-${triggerKey}`}
          onClick={event => {
            event.stopPropagation();
            setOpenPatientIdentity(patientIdentity);
          }}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-violet-50 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-700"
          title="Radiología / Imagenología MMRAD"
          aria-label={`Abrir MMRAD de ${patientName}`}
        >
          <Radio size={14} />
        </button>
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
