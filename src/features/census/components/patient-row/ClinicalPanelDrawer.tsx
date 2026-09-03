/**
 * ClinicalPanelDrawer — "Panel clínico" del paciente (vista Eloísa en vivo).
 *
 * Right-side drawer with three tabs, fetched ON DEMAND from Ficha Médico via the extension:
 *   - Evoluciones: split by profession (Médico / Enfermería / Otros), with an internal handoff
 *     view for the medical and nursing worlds.
 *   - Indicaciones: the classic daily indication sheet — one box per calendar day (régimen →
 *     reposo → fármacos → libres), suspended/archived behind a discreet per-day toggle.
 *   - Cuidados: compact nursing actions grouped by day, with their execution state visible.
 *
 * Nothing is persisted in HHR/Firestore: it is a live read-only view, so the clinical text never
 * widens the app's data footprint. Requires the Ficha Médico tab (same requirement as the rest of
 * the Eloísa sync); degrades to an error state with retry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, FileDown, Loader2, RefreshCw, X } from 'lucide-react';
import {
  parseClinicalPanel,
  requestClinicalPanel,
  type ClinicalPanel,
  type EvolutionProfession,
} from '@/features/rayen-import';
import { CareDayCard, EvolutionCard, IndicationDayCard } from './ClinicalPanelSections';
import { RayenEncounterButton } from './RayenEncounterButton';

interface ClinicalPanelDrawerProps {
  bedId: string;
  patientName: string;
  clinicalEpisodeId: string;
  encounterRouteHint?: 'medical' | 'nurse';
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onOpenHospitalizationReports: () => void;
  onClose: () => void;
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; panel: ClinicalPanel };

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
  clinicalEpisodeId,
  encounterRouteHint,
  canNavigatePrevious = false,
  canNavigateNext = false,
  onNavigatePrevious,
  onNavigateNext,
  onOpenHospitalizationReports,
  onClose,
}) => {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [tab, setTab] = useState<PanelTab>('evolutions');
  const [profession, setProfession] = useState<EvolutionProfession>('medical');
  const [evolutionView, setEvolutionView] = useState<EvolutionView>('notes');
  const drawerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    void requestClinicalPanel(clinicalEpisodeId).then(result => {
      setState(
        result.error
          ? { phase: 'error', message: result.error }
          : { phase: 'ready', panel: parseClinicalPanel(result.events, result.carePlan) }
      );
    });
  }, [clinicalEpisodeId]);

  useEffect(() => {
    let active = true;
    void requestClinicalPanel(clinicalEpisodeId).then(result => {
      if (!active) return;
      // Clinical sources form one required snapshot. Never present an old partial response as full.
      setState(
        result.error
          ? { phase: 'error', message: result.error }
          : { phase: 'ready', panel: parseClinicalPanel(result.events, result.carePlan) }
      );
    });
    return () => {
      active = false;
    };
  }, [clinicalEpisodeId]);

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
      className={clsx(
        'flex-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors',
        tab === key ? 'bg-white text-medical-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      )}
    >
      {label}
      {count !== null && <span className="ml-1 text-[10px] font-bold text-slate-400">{count}</span>}
    </button>
  );

  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-[1100] cursor-default bg-slate-900/30"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Panel clínico de ${patientName}`}
        tabIndex={-1}
        data-testid={`clinical-panel-drawer-${bedId}`}
        className="fixed right-0 top-0 z-[1101] flex h-full w-[460px] max-w-[94vw] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl focus:outline-none"
      >
        <header className="flex items-start gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-[14px] font-bold text-slate-800">{patientName}</h2>
              <RayenEncounterButton
                bedId={bedId}
                patientName={patientName}
                clinicalEpisodeId={clinicalEpisodeId}
                routeHint={encounterRouteHint}
              />
            </div>
            <p className="text-[10px] text-slate-400">
              Cama {bedId} · Eloísa en vivo · no se guarda en HHR
            </p>
          </div>
          <div className="flex shrink-0 items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={onNavigatePrevious}
              disabled={!canNavigatePrevious}
              className="rounded p-1 text-slate-500 hover:bg-white hover:text-medical-700 disabled:cursor-not-allowed disabled:text-slate-300"
              title="Paciente anterior"
              aria-label="Ir al paciente anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={onNavigateNext}
              disabled={!canNavigateNext}
              className="rounded p-1 text-slate-500 hover:bg-white hover:text-medical-700 disabled:cursor-not-allowed disabled:text-slate-300"
              title="Paciente siguiente"
              aria-label="Ir al paciente siguiente"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenHospitalizationReports}
            className="rounded p-1 text-slate-400 hover:bg-sky-50 hover:text-sky-700"
            title="Informes de hospitalización"
            aria-label={`Abrir informes de hospitalización de ${patientName}`}
          >
            <FileDown size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={reload}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Actualizar desde Ficha Médico"
            aria-label="Actualizar panel clínico"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Cerrar"
            aria-label="Cerrar panel clínico"
          >
            <X size={16} />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-slate-200 bg-slate-100 p-1">
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
          <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
            {PROFESSION_TABS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setProfession(p.key)}
                aria-label={`${p.label} (${professionCount(p.key)})`}
                className={clsx(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
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
          </div>
        )}

        {tab === 'evolutions' && state.phase === 'ready' && profession !== 'other' && (
          <div className="flex gap-1 border-b border-slate-200 bg-white px-2 py-1">
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
                className={clsx(
                  'rounded px-2 py-0.5 text-[10px] font-semibold transition-colors',
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

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
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
    </>
  );
};
