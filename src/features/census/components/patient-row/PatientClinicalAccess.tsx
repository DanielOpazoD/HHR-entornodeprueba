/**
 * The «Accesos» column: a patient's four clinical topics in a 2×2 grid, always in the same place.
 * Each opens its window, where the patient is read and, when the row can edit, requested. A topic
 * the patient cannot use leaves its slot empty, so the grid stays aligned down the census.
 */

import React from 'react';

import { buildClinicalPanelKey } from '@/features/census/controllers/clinicalPanelNavigationController';
import { resolvePatientClinicalTopics } from '@/features/census/controllers/patientClinicalTopicsController';
import type { PatientClinicalAccessProps } from './patientRowInputViewContracts';
import { ClinicalActionButton } from './ClinicalActionButton';
import {
  PatientClinicalTopicSurfaces,
  usePatientClinicalTopicSurface,
} from './PatientClinicalTopicSurfaces';
import { PATIENT_CLINICAL_ACCESS_ICON_SRC } from './patientClinicalAccessIcons';
import { openClinicalPanel } from './useActiveClinicalPanel';

type AccessSlot = {
  key: keyof typeof PATIENT_CLINICAL_ACCESS_ICON_SRC;
  label: string;
  hint: string;
  tone: React.ComponentProps<typeof ClinicalActionButton>['tone'];
  onOpen?: () => void;
  badge?: number;
};

const AccessIcon: React.FC<{ slot: AccessSlot; patientName: string; bedId: string }> = ({
  slot,
  patientName,
  bedId,
}) =>
  slot.onOpen ? (
    <ClinicalActionButton
      tone={slot.tone}
      muted
      data-clinical-access={slot.key}
      data-testid={`clinical-access-${slot.key}-${bedId}`}
      label={`${slot.label} de ${patientName}`}
      title={slot.hint}
      hint={slot.hint}
      badge={slot.badge}
      onClick={slot.onOpen}
    >
      <img
        src={PATIENT_CLINICAL_ACCESS_ICON_SRC[slot.key]}
        alt=""
        draggable={false}
        className="size-[18px] object-contain"
      />
    </ClinicalActionButton>
  ) : (
    <span aria-hidden="true" className="size-7" />
  );

export const PatientClinicalAccess: React.FC<PatientClinicalAccessProps> = ({
  patient,
  censusDate,
  isSubRow = false,
  onRequestExams,
  onRequestImaging,
  onViewClinicalDocuments,
  clinicalDocumentCount,
}) => {
  const topics = resolvePatientClinicalTopics(patient);
  const laboratory = !isSubRow && topics.laboratory;
  const imaging = !isSubRow && topics.imaging;
  const requestExams = isSubRow ? undefined : onRequestExams;
  const requestImaging = isSubRow ? undefined : onRequestImaging;
  const topicSurface = usePatientClinicalTopicSurface(patient);
  const episode = patient.clinicalEpisodeId?.trim();
  const patientName = patient.patientName.trim();
  const triggerKey = isSubRow ? `${patient.bedId}-clinical-crib` : patient.bedId;

  const slots: AccessSlot[] = [
    {
      key: 'ficha',
      label: 'Ficha clínica',
      hint: 'Ficha clínica',
      tone: 'clinical',
      onOpen:
        topics.clinicalPanel && episode
          ? () => {
              openClinicalPanel(buildClinicalPanelKey(patient.bedId, episode));
            }
          : undefined,
    },
    {
      key: 'laboratory',
      label: 'Laboratorio',
      hint: laboratory ? 'Laboratorio: ver y solicitar' : 'Solicitar exámenes',
      tone: 'laboratory',
      // Without an episode there is nothing to read, but a request still fits.
      onOpen: laboratory ? () => topicSurface.open('laboratory') : requestExams,
    },
    {
      key: 'imaging',
      label: 'Imágenes',
      hint: imaging ? 'Imágenes: ver y solicitar' : 'Solicitar imagen',
      tone: 'radiology',
      onOpen: imaging ? () => topicSurface.open('imaging') : requestImaging,
    },
    {
      key: 'documents',
      label: 'Documentos',
      hint: 'Documentos clínicos',
      tone: 'documents',
      onOpen: isSubRow ? undefined : onViewClinicalDocuments,
      badge: clinicalDocumentCount,
    },
  ];

  return (
    <>
      <span className="mx-auto grid w-fit grid-cols-[repeat(2,1.75rem)]">
        {slots.map(slot => (
          <AccessIcon key={slot.key} slot={slot} patientName={patientName} bedId={triggerKey} />
        ))}
      </span>
      <PatientClinicalTopicSurfaces
        patient={patient}
        triggerKey={isSubRow ? triggerKey : undefined}
        censusDate={censusDate}
        surface={topicSurface.surface}
        onClose={topicSurface.close}
        onRequestExams={requestExams}
        onRequestImaging={requestImaging}
      />
    </>
  );
};
