/**
 * ClinicalPanelDrawer — "Panel clínico" del paciente (vista Eloísa en vivo).
 *
 * Fetched on demand from Ficha Médico: evolutions/handoffs by profession,
 * daily indications (inactive entries collapsed), and care execution grouped by day.
 *
 * Nothing is persisted in HHR/Firestore: it is a live read-only view, so the clinical text never
 * widens the app's data footprint. Requires the Ficha Médico tab (same requirement as the rest of
 * the Eloísa sync); degrades to an error state with retry.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, FileDown, Loader2, RefreshCw } from 'lucide-react';
import { type EvolutionProfession } from '@/features/rayen-import';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import { CareDayCard, EvolutionCard, IndicationDayCard } from './ClinicalPanelSections';
import { ClinicalPanelHistoryPrintButton } from './ClinicalPanelHistoryPrintButton';
import { ClinicalPanelHeading } from './ClinicalPanelHeading';
import { RayenEncounterButton } from './RayenEncounterButton';
import { PatientDocumentManagerButton } from './PatientDocumentManagerButton';
import { useClinicalPanelSnapshot } from './useClinicalPanelSnapshot';

const PatientDocumentManagerDialog = React.lazy(() =>
  import('./PatientDocumentManagerDialog').then(module => ({
    default: module.PatientDocumentManagerDialog,
  }))
);

interface ClinicalPanelDrawerProps {
  bedId: string;
  patientName: string;
  patientRun?: string;
  clinicalEpisodeId: string;
  admissionDate?: string;
  censusDate?: string;
  encounterRouteHint?: 'medical' | 'nurse';
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onOpenHospitalizationReports: () => void;
  onClose: () => void;
}

type PanelTab = 'evolutions' | 'indications' | 'care';
type EvolutionView = 'notes' | 'handoffs';

const PROFESSION_TABS: { key: EvolutionProfession; label: string; empty: string }[] = [
  { key: 'medical', label: 'Médico', empty: 'Sin registros médicos en los últimos 14 días.' },
  {
    key: 'nursing',
    label: 'Enfermería',
    empty: 'Sin registros de enfermería en los últimos 14 días.',
  },
  {
    key: 'other',
    label: 'Otros',
    empty: 'Sin evoluciones de otros profesionales en los últimos 14 días.',
  },
];

export const ClinicalPanelDrawer: React.FC<ClinicalPanelDrawerProps> = ({
  bedId,
  patientName,
  patientRun = '',
  clinicalEpisodeId,
  admissionDate,
  censusDate,
  encounterRouteHint,
  canNavigatePrevious = false,
  canNavigateNext = false,
  onNavigatePrevious,
  onNavigateNext,
  onOpenHospitalizationReports,
  onClose,
}) => {
  const { state, documentState, reload } = useClinicalPanelSnapshot(clinicalEpisodeId);
  const [tab, setTab] = useState<PanelTab>('evolutions');
  const [profession, setProfession] = useState<EvolutionProfession>('medical');
  const [evolutionView, setEvolutionView] = useState<EvolutionView>('notes');
  const [isDocumentManagerOpen, setIsDocumentManagerOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Move focus into the drawer on open so keyboard/screen-reader users land inside the modal.
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  const panel = state.phase === 'ready' ? state.panel : null;
  const professionCount = (key: EvolutionProfession): number =>
    panel ? panel.evolutions.filter(e => e.profession === key).length : 0;
  const professionEntries = panel
    ? panel.evolutions.filter(entry => entry.profession === profession)
    : [];
  const visibleEvolutions = professionEntries.filter(entry => {
    if (profession === 'other') return true;
    return evolutionView === 'handoffs'
      ? entry.kind === 'shift-change'
      : entry.kind !== 'shift-change';
  });

  const tabButton = (key: PanelTab, label: string, count: number | null): React.ReactElement => (
    <button
      type="button"
      onClick={() => setTab(key)}
      aria-label={count === null ? label : `${label} (${count})`}
      aria-pressed={tab === key}
      className={clsx(
        'min-w-0 flex-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700',
        tab === key ? 'bg-white text-medical-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      )}
    >
      {label}
      {count !== null && <span className="ml-1 text-[10px] font-bold text-slate-400">{count}</span>}
    </button>
  );

  // Keep native text selection outside the census row's draggable DOM subtree.
  return createPortal(
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        style={{ zIndex: LAYER_Z_INDEX.drawerBackdrop }}
        className="fixed inset-0 cursor-default bg-slate-900/30"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Panel clínico de ${patientName}`}
        tabIndex={-1}
        data-testid={`clinical-panel-drawer-${bedId}`}
        onDragStart={event => event.stopPropagation()}
        style={{ zIndex: LAYER_Z_INDEX.drawer }}
        className={clsx(
          'clinical-panel-drawer fixed right-0 top-0 flex h-full max-w-full cursor-auto select-text flex-col border-l border-slate-200 bg-slate-50 shadow-xl focus:outline-none',
          isWide ? 'w-[680px]' : 'w-[460px]'
        )}
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
          <ClinicalPanelHeading
            bedId={bedId}
            patientName={patientName}
            isWide={isWide}
            onToggleWidth={() => setIsWide(wide => !wide)}
            onClose={onClose}
          />
          <div
            className="mt-1 flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Accesos del paciente"
          >
            <RayenEncounterButton
              bedId={bedId}
              patientName={patientName}
              clinicalEpisodeId={clinicalEpisodeId}
              routeHint={encounterRouteHint}
            />
            <div className="flex shrink-0 items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={onNavigatePrevious}
                disabled={!canNavigatePrevious}
                className="inline-flex size-7 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700 disabled:cursor-not-allowed disabled:text-slate-300"
                title="Paciente anterior"
                aria-label="Ir al paciente anterior"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={onNavigateNext}
                disabled={!canNavigateNext}
                className="inline-flex size-7 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700 disabled:cursor-not-allowed disabled:text-slate-300"
                title="Paciente siguiente"
                aria-label="Ir al paciente siguiente"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <button
              type="button"
              onClick={onOpenHospitalizationReports}
              className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100 hover:text-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
              title="Informes de hospitalización"
              aria-label={`Abrir informes de hospitalización de ${patientName}`}
            >
              <FileDown size={14} aria-hidden="true" />
              <span>Informes</span>
            </button>
            <PatientDocumentManagerButton
              patientName={patientName}
              loading={documentState.phase === 'loading'}
              count={documentState.phase === 'ready' ? documentState.documents.length : null}
              onOpen={() => setIsDocumentManagerOpen(true)}
            />
            <button
              type="button"
              onClick={reload}
              disabled={state.phase === 'loading'}
              className="disabled:cursor-wait disabled:opacity-50 ml-auto inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700"
              title="Actualizar desde Ficha Médico"
              aria-label="Actualizar panel clínico"
            >
              <RefreshCw
                size={14}
                className={state.phase === 'loading' ? 'animate-spin' : undefined}
              />
            </button>
          </div>
        </header>

        <nav
          aria-label="Secciones clínicas"
          className="flex shrink-0 gap-1 border-b border-slate-200 bg-slate-100 px-1 py-0.5"
        >
          {tabButton('evolutions', 'Evoluciones', panel ? panel.evolutions.length : null)}
          {tabButton(
            'indications',
            'Indicaciones',
            panel
              ? panel.indicationDays.reduce(
                  (sum, day) => sum + day.active.length + day.suspended.length,
                  0
                )
              : null
          )}
          {tabButton(
            'care',
            'Cuidados',
            panel ? panel.careDays.reduce((sum, day) => sum + day.actions.length, 0) : null
          )}
        </nav>

        {tab === 'evolutions' && state.phase === 'ready' && (
          <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
            {PROFESSION_TABS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setProfession(p.key)}
                aria-label={`${p.label} (${professionCount(p.key)})`}
                aria-pressed={profession === p.key}
                className={clsx(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700',
                  profession === p.key
                    ? 'bg-medical-100 text-medical-700 ring-1 ring-medical-200'
                    : 'text-slate-500 hover:bg-slate-100'
                )}
              >
                {p.label}
                <span className="ml-1 text-[9px] font-bold opacity-60">
                  {professionCount(p.key)}
                </span>
              </button>
            ))}
            <ClinicalPanelHistoryPrintButton
              patientName={patientName}
              patientRun={patientRun}
              clinicalEpisodeId={clinicalEpisodeId}
              admissionDate={admissionDate}
              censusDate={censusDate}
            />
          </div>
        )}

        {tab === 'evolutions' && state.phase === 'ready' && profession !== 'other' && (
          <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-2 py-0.5">
            {(
              [
                {
                  key: 'notes' as const,
                  label: 'Evoluciones',
                  count: professionEntries.filter(entry => entry.kind !== 'shift-change').length,
                },
                {
                  key: 'handoffs' as const,
                  label: 'Entrega de turno',
                  count: professionEntries.filter(entry => entry.kind === 'shift-change').length,
                },
              ] satisfies Array<{ key: EvolutionView; label: string; count: number }>
            ).map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setEvolutionView(item.key)}
                aria-label={`${item.label} (${item.count})`}
                aria-pressed={evolutionView === item.key}
                className={clsx(
                  'rounded px-2 py-0.5 text-[10px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700',
                  evolutionView === item.key
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                )}
              >
                {item.label}
                <span className="ml-1 opacity-70">{item.count}</span>
              </button>
            ))}
          </div>
        )}

        <div
          data-testid="clinical-panel-content"
          className="min-h-0 flex-1 cursor-text select-text space-y-2 overflow-y-auto overscroll-contain break-words p-3"
        >
          {state.phase === 'loading' && (
            <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-[12px]">Consultando Ficha Médico…</p>
            </div>
          )}
          {state.phase === 'error' && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="px-4 text-[12px] text-red-600">{state.message}</p>
              <button
                type="button"
                onClick={reload}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Reintentar
              </button>
            </div>
          )}

          {state.phase === 'ready' && tab === 'evolutions' && (
            <>
              {visibleEvolutions.length === 0 && (
                <p className="py-10 text-center text-[12px] italic text-slate-400">
                  {evolutionView === 'handoffs' && profession !== 'other'
                    ? `Sin entregas de turno de ${profession === 'medical' ? 'medicina' : 'enfermería'} en los últimos 14 días.`
                    : PROFESSION_TABS.find(p => p.key === profession)?.empty}
                </p>
              )}
              {visibleEvolutions.map(entry => (
                <EvolutionCard key={`${entry.kind}-${entry.id}`} entry={entry} />
              ))}
            </>
          )}

          {state.phase === 'ready' && tab === 'indications' && (
            <>
              {panel && panel.indicationDays.length === 0 && (
                <p className="py-10 text-center text-[12px] italic text-slate-400">
                  Sin indicaciones en los últimos 14 días.
                </p>
              )}
              {panel?.indicationDays.map(day => (
                <IndicationDayCard key={day.day} day={day} />
              ))}
            </>
          )}

          {state.phase === 'ready' && tab === 'care' && (
            <>
              {panel && panel.careDays.length === 0 && (
                <p className="py-10 text-center text-[12px] italic text-slate-400">
                  Sin cuidados asignados registrados en el plan visible.
                </p>
              )}
              {panel?.careDays.map(day => (
                <CareDayCard key={day.day} day={day} />
              ))}
            </>
          )}
        </div>
      </aside>
      {isDocumentManagerOpen && (
        <React.Suspense fallback={null}>
          <PatientDocumentManagerDialog
            patientName={patientName}
            clinicalEpisodeId={clinicalEpisodeId}
            documents={documentState.phase === 'ready' ? documentState.documents : null}
            error={documentState.phase === 'error' ? documentState.message : undefined}
            onClose={() => setIsDocumentManagerOpen(false)}
          />
        </React.Suspense>
      )}
    </>,
    document.body
  );
};
