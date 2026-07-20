/**
 * ClinicalPanelTrigger — discreet per-patient button that opens the ClinicalPanelDrawer
 * (evoluciones + indicaciones + cuidados from Ficha Médico, live view). Self-contained (button + drawer
 * state) so host cells only add one element. Rendered only for synced patients — the panel is
 * fetched by `clinicalEpisodeId`, which exists only after an Eloísa sync.
 */

import React, { useState } from 'react';
import { BookOpenText, FileDown } from 'lucide-react';

import { resolveClinicalPanelNavigation } from '@/features/census/controllers/clinicalPanelNavigationController';
import { PatientHospitalizationReportsDialog } from '@/features/census/components/PatientHospitalizationReportsDialog';
import { ClinicalPanelDrawer } from './ClinicalPanelDrawer';

interface ClinicalPanelTriggerProps {
  bedId: string;
  patientName: string;
  patientRun: string;
  clinicalEpisodeId?: string;
}

export const ClinicalPanelTrigger: React.FC<ClinicalPanelTriggerProps> = ({
  bedId,
  patientName,
  patientRun,
  clinicalEpisodeId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [areReportsOpen, setAreReportsOpen] = useState(false);
  const episode = (clinicalEpisodeId || '').trim();
  const canOpenReports = /^[0-9]{6,8}[0-9K]$/.test(
    patientRun.toUpperCase().replace(/[^0-9K]/g, '')
  );
  if (!episode || !patientName.trim()) return null;
  const panelKey = `${bedId}:${episode}`;
  const navigation = isOpen
    ? resolveClinicalPanelNavigation(document, panelKey)
    : { previous: null, next: null };

  const navigatePanel = (direction: 'previous' | 'next'): void => {
    const target = resolveClinicalPanelNavigation(document, panelKey)[direction];
    if (!target) return;
    setIsOpen(false);
    target.click();
  };

  return (
    <>
      <span className="inline-flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          data-testid={`clinical-panel-trigger-${bedId}`}
          data-clinical-panel-key={panelKey}
          onClick={event => {
            event.stopPropagation();
            setIsOpen(true);
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-medical-50 hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-500"
          title="Panel clínico (evoluciones, indicaciones y cuidados de Eloísa)"
          aria-label={`Abrir panel clínico de ${patientName}`}
        >
          <BookOpenText size={14} />
        </button>
        {canOpenReports && (
          <button
            type="button"
            data-testid={`hospitalization-reports-trigger-${bedId}`}
            onClick={event => {
              event.stopPropagation();
              setAreReportsOpen(true);
            }}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 disabled:cursor-progress disabled:opacity-60"
            title="Informes de hospitalización"
            aria-label={`Abrir informes de hospitalización de ${patientName}`}
          >
            <FileDown size={14} aria-hidden="true" />
          </button>
        )}
      </span>
      {isOpen && (
        <ClinicalPanelDrawer
          bedId={bedId}
          patientName={patientName}
          clinicalEpisodeId={episode}
          canNavigatePrevious={navigation.previous !== null}
          canNavigateNext={navigation.next !== null}
          onNavigatePrevious={() => navigatePanel('previous')}
          onNavigateNext={() => navigatePanel('next')}
          onClose={() => setIsOpen(false)}
        />
      )}
      <PatientHospitalizationReportsDialog
        isOpen={areReportsOpen}
        onClose={() => setAreReportsOpen(false)}
        patientName={patientName}
        patientRun={patientRun}
        currentEpisodeId={episode}
      />
    </>
  );
};
