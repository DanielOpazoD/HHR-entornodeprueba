/**
 * ClinicalPanelTrigger — discreet per-patient button that opens the ClinicalPanelDrawer
 * (evoluciones + indicaciones + cuidados from Ficha Médico, live view). Self-contained (button + drawer
 * state) so host cells only add one element. Rendered only for synced patients — the panel is
 * fetched by `clinicalEpisodeId`, which exists only after an Eloísa sync.
 */

import React, { useState } from 'react';
import { BookOpenText, ExternalLink, Loader2 } from 'lucide-react';

import { useNotification } from '@/context/UIContext';
import { resolveClinicalPanelNavigation } from '@/features/census/controllers/clinicalPanelNavigationController';
import { requestRayenEncounterNavigation } from '@/features/rayen-import';
import { ClinicalPanelDrawer } from './ClinicalPanelDrawer';

interface ClinicalPanelTriggerProps {
  bedId: string;
  patientName: string;
  clinicalEpisodeId?: string;
}

export const ClinicalPanelTrigger: React.FC<ClinicalPanelTriggerProps> = ({
  bedId,
  patientName,
  clinicalEpisodeId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpeningEncounter, setIsOpeningEncounter] = useState(false);
  const { success, error: notifyError } = useNotification();
  const episode = (clinicalEpisodeId || '').trim();
  if (!episode || !patientName.trim()) return null;
  const panelKey = `${bedId}:${episode}`;
  const navigation = isOpen
    ? resolveClinicalPanelNavigation(document, panelKey)
    : { previous: null, next: null };

  const navigatePanel = (target: HTMLButtonElement | null): void => {
    if (!target) return;
    setIsOpen(false);
    target.click();
  };

  const handleOpenEncounter = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isOpeningEncounter) return;
    setIsOpeningEncounter(true);
    try {
      const result = await requestRayenEncounterNavigation(episode);
      if (result.ok) {
        success(
          'Eloísa abierta',
          result.reused
            ? 'Se activó la pestaña de Ficha Médico en el episodio seleccionado.'
            : 'Se abrió Ficha Médico en el episodio seleccionado.'
        );
      } else {
        notifyError('No se pudo abrir Eloísa', result.error || 'Error de navegación desconocido.');
      }
    } catch (error) {
      notifyError(
        'No se pudo abrir Eloísa',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsOpeningEncounter(false);
    }
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
        <button
          type="button"
          data-testid={`rayen-encounter-trigger-${bedId}`}
          onClick={handleOpenEncounter}
          disabled={isOpeningEncounter}
          aria-busy={isOpeningEncounter}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-teal-50 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-60"
          title="Abrir este episodio en Ficha Médico"
          aria-label={`Abrir a ${patientName} en Eloísa`}
        >
          {isOpeningEncounter ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink size={14} aria-hidden="true" />
          )}
        </button>
      </span>
      {isOpen && (
        <ClinicalPanelDrawer
          bedId={bedId}
          patientName={patientName}
          clinicalEpisodeId={episode}
          canNavigatePrevious={navigation.previous !== null}
          canNavigateNext={navigation.next !== null}
          onNavigatePrevious={() => navigatePanel(navigation.previous)}
          onNavigateNext={() => navigatePanel(navigation.next)}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};
