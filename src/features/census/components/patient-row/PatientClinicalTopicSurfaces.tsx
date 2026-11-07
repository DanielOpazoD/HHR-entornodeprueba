/**
 * The windows a main row's turtle menu opens: the clinical panel (headless, opened through
 * `openClinicalPanel`), the laboratory viewer and the MMRAD viewer. Each viewer reads the
 * patient's results; its request button appears only when the row can take that request.
 */

import React from 'react';

import type { PatientData } from './patientRowContracts';
import { ClinicalPanelTrigger } from './ClinicalPanelTrigger';
import { resolveNameInputState } from './nameInputController';

const LabResultsViewerModal = React.lazy(() =>
  import('@/features/laboratory').then(module => ({
    default: module.LabResultsViewerModal,
  }))
);

const RadiologyViewerModal = React.lazy(() =>
  import('@/components/modals/RadiologyViewerModal').then(module => ({
    default: module.RadiologyViewerModal,
  }))
);

export type PatientClinicalTopicSurface = 'laboratory' | 'imaging';

interface OpenSurface {
  kind: PatientClinicalTopicSurface;
  patientIdentity: string;
}

/** Which viewer is open for this patient; a new patient in the bed closes it. */
export const usePatientClinicalTopicSurface = (patient?: PatientData) => {
  const [openSurface, setOpenSurface] = React.useState<OpenSurface | null>(null);
  const patientIdentity = patient
    ? `${patient.rut.trim()}:${patient.clinicalEpisodeId?.trim() ?? ''}`
    : '';
  const surface = openSurface?.patientIdentity === patientIdentity ? openSurface.kind : null;

  React.useEffect(() => {
    setOpenSurface(current => (current?.patientIdentity === patientIdentity ? current : null));
  }, [patientIdentity]);

  const open = React.useCallback(
    (kind: PatientClinicalTopicSurface) => setOpenSurface({ kind, patientIdentity }),
    [patientIdentity]
  );
  const close = React.useCallback(() => setOpenSurface(null), []);
  return { surface, open, close };
};

interface PatientClinicalTopicSurfacesProps {
  patient: PatientData;
  censusDate?: string;
  surface: PatientClinicalTopicSurface | null;
  onClose: () => void;
  onRequestExams?: () => void;
  onRequestImaging?: () => void;
}

export const PatientClinicalTopicSurfaces: React.FC<PatientClinicalTopicSurfacesProps> = ({
  patient,
  censusDate,
  surface,
  onClose,
  onRequestExams,
  onRequestImaging,
}) => {
  const { fullName } = resolveNameInputState({ data: patient });
  const patientName = patient.patientName.trim();
  const patientRut = patient.rut.trim();
  const clinicalEpisodeId = patient.clinicalEpisodeId?.trim();
  const switchTo = (request?: () => void) =>
    request
      ? () => {
          onClose();
          request();
        }
      : undefined;

  return (
    <>
      <ClinicalPanelTrigger
        headless
        bedId={patient.bedId}
        patientName={fullName}
        patientRun={patient.rut}
        clinicalEpisodeId={patient.clinicalEpisodeId}
        encounterRouteHint={patient.eloisaManualImportAudit?.encounterRoute}
        admissionDate={patient.admissionDate}
        censusDate={censusDate}
      />

      {surface === 'laboratory' && clinicalEpisodeId && (
        <React.Suspense fallback={null}>
          <LabResultsViewerModal
            isOpen
            onClose={onClose}
            patients={[
              {
                bedId: patient.bedId,
                label: `${patient.bedId} - ${patientName}`,
                patientName,
                rut: patientRut,
                clinicalEpisodeId,
                birthDate: patient.birthDate,
                diagnosis: patient.pathology,
              },
            ]}
            initialPatientRut={patientRut}
            autoSearchInitialPatient
            onRequestExams={switchTo(onRequestExams)}
          />
        </React.Suspense>
      )}

      {surface === 'imaging' && (
        <React.Suspense fallback={null}>
          <RadiologyViewerModal
            isOpen
            onClose={onClose}
            patients={[
              {
                bedId: patient.bedId,
                label: `${patient.bedId} · ${patientName}`,
                patientName,
                rut: patientRut,
                diagnosis: patient.pathology,
              },
            ]}
            initialPatientRut={patientRut}
            autoSearchInitialPatient
            onRequestImaging={switchTo(onRequestImaging)}
          />
        </React.Suspense>
      )}
    </>
  );
};
