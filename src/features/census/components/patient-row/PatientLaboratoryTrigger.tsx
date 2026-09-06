import React from 'react';
import { FlaskConical } from 'lucide-react';

import type { PatientData } from './patientRowContracts';
import { ClinicalActionButton } from './ClinicalActionButton';

const LabResultsViewerModal = React.lazy(() =>
  import('@/features/laboratory').then(module => ({
    default: module.LabResultsViewerModal,
  }))
);

const ExamRequestModal = React.lazy(() =>
  import('@/components/modals/ExamRequestModal').then(module => ({
    default: module.ExamRequestModal,
  }))
);

interface PatientLaboratoryTriggerProps {
  patient: PatientData;
  triggerKey?: string;
  censusDate?: string;
}

type PatientLaboratorySurface = 'viewer' | 'request' | null;

interface OpenPatientLaboratorySurface {
  kind: Exclude<PatientLaboratorySurface, null>;
  patientIdentity: string;
}

export const PatientLaboratoryTrigger: React.FC<PatientLaboratoryTriggerProps> = ({
  patient,
  triggerKey = patient.bedId,
  censusDate,
}) => {
  const [openSurface, setOpenSurface] = React.useState<OpenPatientLaboratorySurface | null>(null);
  const patientName = patient.patientName.trim();
  const patientRut = patient.rut.trim();
  const clinicalEpisodeId = patient.clinicalEpisodeId?.trim();
  const patientIdentity = `${patientRut}:${clinicalEpisodeId ?? ''}`;
  const activeSurface = openSurface?.patientIdentity === patientIdentity ? openSurface.kind : null;

  React.useEffect(() => {
    setOpenSurface(current => (current?.patientIdentity === patientIdentity ? current : null));
  }, [patientIdentity]);

  if (
    !patientName ||
    !patientRut ||
    patientRut === '-' ||
    patient.documentType === 'Pasaporte' ||
    !clinicalEpisodeId
  ) {
    return null;
  }

  const labPatient = {
    bedId: patient.bedId,
    label: `${patient.bedId} - ${patientName}`,
    patientName,
    rut: patientRut,
    clinicalEpisodeId,
    birthDate: patient.birthDate,
    diagnosis: patient.pathology,
  };

  return (
    <>
      <span className="inline-flex shrink-0 items-center">
        <ClinicalActionButton
          tone="laboratory"
          data-testid={`patient-laboratory-trigger-${triggerKey}`}
          onClick={() => {
            setOpenSurface({ kind: 'viewer', patientIdentity });
          }}
          title="Laboratorio / Exámenes Syslab"
          label={`Abrir laboratorio de ${patientName}`}
        >
          <FlaskConical size={14} />
        </ClinicalActionButton>
      </span>

      {activeSurface === 'viewer' && (
        <React.Suspense fallback={null}>
          <LabResultsViewerModal
            isOpen
            onClose={() => setOpenSurface(null)}
            patients={[labPatient]}
            initialPatientRut={patientRut}
            autoSearchInitialPatient
            onRequestExams={() => setOpenSurface({ kind: 'request', patientIdentity })}
          />
        </React.Suspense>
      )}

      {activeSurface === 'request' && (
        <React.Suspense fallback={null}>
          <ExamRequestModal
            isOpen
            onClose={() => setOpenSurface(null)}
            patient={patient}
            recordDate={censusDate}
          />
        </React.Suspense>
      )}
    </>
  );
};
