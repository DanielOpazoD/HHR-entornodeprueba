/**
 * ClinicalPanelTrigger — discreet per-patient button that opens the ClinicalPanelDrawer
 * (evoluciones + indicaciones + cuidados from Ficha Médico, live view). Self-contained (button + drawer
 * state) so host cells only add one element. Rendered only for synced patients — the panel is
 * fetched by `clinicalEpisodeId`, which exists only after an Eloísa sync.
 */

import React, { useState } from 'react';
import { BookOpenText } from 'lucide-react';

import { resolveClinicalPanelNavigation } from '@/features/census/controllers/clinicalPanelNavigationController';
import { PatientHospitalizationReportsDialog } from '@/features/census/components/PatientHospitalizationReportsDialog';

const ClinicalPanelDrawer = React.lazy(() =>
  import('./ClinicalPanelDrawer').then(module => ({ default: module.ClinicalPanelDrawer }))
);

interface ClinicalPanelTriggerProps {
  bedId: string;
  triggerKey?: string;
  patientName: string;
  patientRun: string;
  clinicalEpisodeId?: string;
  encounterRouteHint?: 'medical' | 'nurse';
  admissionDate?: string;
  censusDate?: string;
}

export const ClinicalPanelTrigger: React.FC<ClinicalPanelTriggerProps> = ({
  bedId,
  triggerKey = bedId,
  patientName,
  patientRun,
  clinicalEpisodeId,
  encounterRouteHint,
  admissionDate,
  censusDate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [areReportsOpen, setAreReportsOpen] = useState(false);
  const episode = (clinicalEpisodeId || '').trim();
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
      <span className="inline-flex shrink-0 items-center">
        <button
          type="button"
          data-testid={`clinical-panel-trigger-${triggerKey}`}
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
      </span>
      {isOpen && (
        <React.Suspense fallback={null}>
          <ClinicalPanelDrawer
            bedId={bedId}
            patientName={patientName}
            patientRun={patientRun}
            clinicalEpisodeId={episode}
            admissionDate={admissionDate}
            censusDate={censusDate}
            encounterRouteHint={encounterRouteHint}
            canNavigatePrevious={navigation.previous !== null}
            canNavigateNext={navigation.next !== null}
            onNavigatePrevious={() => navigatePanel('previous')}
            onNavigateNext={() => navigatePanel('next')}
            onOpenHospitalizationReports={() => setAreReportsOpen(true)}
            onClose={() => setIsOpen(false)}
          />
        </React.Suspense>
      )}
      <PatientHospitalizationReportsDialog
        isOpen={areReportsOpen}
        onClose={() => setAreReportsOpen(false)}
        patientName={patientName}
        patientRun={patientRun}
        currentEpisodeId={episode}
        admissionDate={admissionDate}
      />
    </>
  );
};
