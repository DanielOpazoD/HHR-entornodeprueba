/**
 * ClinicalPanelTrigger — discreet per-patient button that opens the ClinicalPanelDrawer
 * (evoluciones + indicaciones from Ficha Médico, live view). Self-contained (button + drawer
 * state) so host cells only add one element. Rendered only for synced patients — the panel is
 * fetched by `clinicalEpisodeId`, which exists only after an Eloísa sync.
 */

import React, { useState } from 'react';
import { BookOpenText } from 'lucide-react';

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
  const episode = (clinicalEpisodeId || '').trim();
  if (!episode || !patientName.trim()) return null;

  return (
    <>
      <button
        type="button"
        data-testid={`clinical-panel-trigger-${bedId}`}
        onClick={event => {
          event.stopPropagation();
          setIsOpen(true);
        }}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-medical-50 hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-500"
        title="Panel clínico (evoluciones e indicaciones de Eloísa)"
        aria-label={`Abrir panel clínico de ${patientName}`}
      >
        <BookOpenText size={14} />
      </button>
      {isOpen && (
        <ClinicalPanelDrawer
          bedId={bedId}
          patientName={patientName}
          clinicalEpisodeId={episode}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};
