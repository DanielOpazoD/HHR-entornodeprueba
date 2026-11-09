/**
 * The «Accesos» column: one rongorongo tablet per patient, always in the same place. It opens a
 * ring with the patient's four clinical topics around the clinical explorer. Each topic opens its
 * window, where the patient is read and, when the row can edit, requested. A topic the patient
 * cannot use stays in the ring, greyed out, so the ring never changes shape. A small Eloísa mark
 * on the button's lower-right edge opens the episode in Eloísa, as nurses do.
 */

import React, { useCallback, useRef, useState } from 'react';

import { buildClinicalPanelKey } from '@/features/census/controllers/clinicalPanelNavigationController';
import { resolvePatientClinicalTopics } from '@/features/census/controllers/patientClinicalTopicsController';
import type { PatientClinicalAccessProps } from './patientRowInputViewContracts';
import { openClinicalExplorer } from '../clinical-explorer/clinicalExplorerStore';
import {
  ClinicalAccessRadialMenu,
  type ClinicalAccessRadialItem,
} from './ClinicalAccessRadialMenu';
import {
  PatientClinicalTopicSurfaces,
  usePatientClinicalTopicSurface,
} from './PatientClinicalTopicSurfaces';
import { CLINICAL_ACCESS_ICON_SRC } from './patientClinicalAccessIcons';
import { buildEloisaNurseEncounterUrl } from './eloisaPatientLink';
import { openClinicalPanel } from './useActiveClinicalPanel';

export const PatientClinicalAccess: React.FC<PatientClinicalAccessProps> = ({
  patient,
  censusDate,
  isSubRow = false,
  onRequestExams,
  onRequestImaging,
  onViewClinicalDocuments,
  clinicalDocumentCount,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The ring is centred on the button it opened from.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => {
    setAnchor(null);
    triggerRef.current?.focus();
  }, []);
  const topics = resolvePatientClinicalTopics(patient);
  const laboratory = !isSubRow && topics.laboratory;
  const imaging = !isSubRow && topics.imaging;
  const requestExams = isSubRow ? undefined : onRequestExams;
  const requestImaging = isSubRow ? undefined : onRequestImaging;
  const viewDocuments = isSubRow ? undefined : onViewClinicalDocuments;
  const topicSurface = usePatientClinicalTopicSurface(patient);
  const episode = patient.clinicalEpisodeId?.trim();
  const patientName = patient.patientName.trim();
  const triggerKey = isSubRow ? `${patient.bedId}-clinical-crib` : patient.bedId;

  const items: ClinicalAccessRadialItem[] = [
    {
      key: 'ficha',
      label: 'Ficha clínica',
      onOpen:
        topics.clinicalPanel && episode
          ? () => openClinicalPanel(buildClinicalPanelKey(patient.bedId, episode))
          : undefined,
    },
    {
      key: 'laboratory',
      label: 'Laboratorio',
      // Without an episode there is nothing to read, but a request still fits.
      onOpen: laboratory ? () => topicSurface.open('laboratory') : requestExams,
    },
    {
      key: 'imaging',
      label: 'Imágenes',
      onOpen: imaging ? () => topicSurface.open('imaging') : requestImaging,
    },
    {
      key: 'documents',
      label: 'Documentos',
      onOpen: viewDocuments,
      badge: clinicalDocumentCount,
    },
  ];
  // The explorer lists main rows only, like the ficha's own entry to it.
  const explore =
    !isSubRow && censusDate && topics.clinicalExplorer
      ? () => openClinicalExplorer({ censusDate, bedId: patient.bedId })
      : undefined;

  return (
    <>
      <span className="relative mx-auto block size-10">
        <button
          ref={triggerRef}
          type="button"
          data-clinical-access="menu"
          data-testid={`clinical-access-${triggerKey}`}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          aria-label={`Accesos de ${patientName}`}
          title="Ficha clínica, laboratorio, imágenes, documentos y explorador clínico"
          onClick={event => {
            event.stopPropagation();
            const button = event.currentTarget;
            setAnchor(open => (open ? null : button));
          }}
          className="group flex size-10 items-center justify-center rounded-full transition-colors duration-200 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700"
        >
          <img
            src={CLINICAL_ACCESS_ICON_SRC}
            alt=""
            draggable={false}
            className="size-[30px] object-contain opacity-40 transition duration-300 group-hover:-rotate-[8deg] group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-expanded:opacity-100"
          />
        </button>
        {episode && (
          <a
            href={buildEloisaNurseEncounterUrl(episode)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir a ${patientName} en Eloísa`}
            title="Abrir en Eloísa"
            data-testid={`clinical-access-eloisa-${triggerKey}`}
            onClick={event => event.stopPropagation()}
            className="absolute -bottom-0.5 -right-1 flex size-[18px] items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-emerald-200 transition hover:scale-110 hover:ring-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700"
          >
            <img
              src="/images/logos/rayen-mark.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="size-3.5 object-contain"
            />
          </a>
        )}
      </span>
      {anchor && (
        <ClinicalAccessRadialMenu
          anchor={anchor}
          patientName={patientName}
          triggerKey={triggerKey}
          items={items}
          onExplore={explore}
          onClose={close}
        />
      )}
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
