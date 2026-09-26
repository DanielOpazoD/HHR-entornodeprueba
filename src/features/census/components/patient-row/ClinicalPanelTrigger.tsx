/**
 * ClinicalPanelTrigger — discreet per-patient button that opens the ClinicalPanelDrawer
 * (evoluciones + indicaciones + cuidados from Ficha Médico, live view). Self-contained (button + drawer
 * state) so host cells only add one element. Rendered only for synced patients — the panel is
 * fetched by `clinicalEpisodeId`, which exists only after an Eloísa sync.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenText, X } from 'lucide-react';

import { resolveClinicalPanelNavigation } from '@/features/census/controllers/clinicalPanelNavigationController';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import { useActiveClinicalPanel } from './useActiveClinicalPanel';
import { ClinicalActionButton } from './ClinicalActionButton';

const PatientHospitalizationReportsDialog = React.lazy(() =>
  import('@/features/census/components/PatientHospitalizationReportsDialog').then(module => ({
    default: module.PatientHospitalizationReportsDialog,
  }))
);

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

/** Occupies the drawer while its deferred code loads, so the first click has immediate feedback. */
const ClinicalPanelImportFallback: React.FC<{
  bedId: string;
  patientName: string;
  onClose: () => void;
}> = ({ bedId, patientName, onClose }) => {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        style={{ zIndex: LAYER_Z_INDEX.drawerBackdrop }}
        className="fixed inset-0 cursor-default bg-slate-900/30"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Abriendo panel clínico de ${patientName}`}
        aria-busy="true"
        tabIndex={-1}
        data-testid="clinical-panel-module-loading"
        style={{ zIndex: LAYER_Z_INDEX.drawer }}
        className="clinical-panel-drawer fixed right-0 top-0 flex h-full w-[460px] max-w-full flex-col border-l border-slate-200 bg-slate-50 shadow-xl focus:outline-none"
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[14px] font-semibold leading-snug text-slate-800">
              {patientName}
            </h2>
            <p className="mt-0.5 text-[10px] text-slate-500">Cama {bedId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel clínico"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700"
          >
            <X size={16} />
          </button>
        </header>
        <div
          className="flex shrink-0 gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map(index => (
            <span key={index} className="h-5 flex-1 rounded bg-slate-200" />
          ))}
        </div>
        <div className="flex-1 space-y-3 bg-white p-3">
          <p className="text-xs text-slate-500">Abriendo ficha clínica…</p>
          <div aria-hidden="true" className="space-y-3">
            {[0, 1].map(index => (
              <div key={index} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="h-3 w-32 rounded bg-slate-100" />
                <div className="h-2.5 w-full rounded bg-slate-100" />
                <div className="h-2.5 w-5/6 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>,
    document.body
  );
};

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
  const [areReportsOpen, setAreReportsOpen] = useState(false);
  const episode = (clinicalEpisodeId || '').trim();
  const { isOpen, open, close } = useActiveClinicalPanel(
    JSON.stringify([triggerKey, episode, patientRun, censusDate, patientName])
  );
  if (!episode || !patientName.trim()) return null;
  const panelKey = `${bedId}:${episode}`;
  const navigation = isOpen
    ? resolveClinicalPanelNavigation(document, panelKey)
    : { previous: null, next: null };

  const navigatePanel = (direction: 'previous' | 'next'): void => {
    const target = resolveClinicalPanelNavigation(document, panelKey)[direction];
    if (!target) return;
    close();
    target.click();
  };

  return (
    <>
      <span className="inline-flex shrink-0 items-center">
        <ClinicalActionButton
          tone="clinical"
          data-testid={`clinical-panel-trigger-${triggerKey}`}
          data-clinical-panel-key={panelKey}
          onClick={() => {
            setAreReportsOpen(false);
            open();
          }}
          title="Panel clínico (evoluciones, indicaciones y cuidados de Eloísa)"
          hint="Ficha clínica"
          label={`Abrir panel clínico de ${patientName}`}
        >
          <BookOpenText size={14} />
        </ClinicalActionButton>
      </span>
      {isOpen && (
        <React.Suspense
          fallback={
            <ClinicalPanelImportFallback bedId={bedId} patientName={patientName} onClose={close} />
          }
        >
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
            onClose={close}
          />
        </React.Suspense>
      )}
      {isOpen && areReportsOpen && (
        <React.Suspense fallback={null}>
          <PatientHospitalizationReportsDialog
            isOpen
            onClose={() => setAreReportsOpen(false)}
            patientName={patientName}
            patientRun={patientRun}
            currentEpisodeId={episode}
            admissionDate={admissionDate}
            censusDate={censusDate}
          />
        </React.Suspense>
      )}
    </>
  );
};
