/**
 * ClinicalPanelDrawer — "Panel clínico" del paciente (vista Eloísa en vivo).
 *
 * Right-side drawer with two tabs, fetched ON DEMAND from Ficha Médico via the extension:
 *   - Evoluciones: split by profession (Médicas / Enfermería / Otros) with the author of every
 *     note; nursing shift-change notes file under Enfermería.
 *   - Indicaciones: the classic daily indication sheet — one box per calendar day (régimen →
 *     reposo → fármacos → libres), suspended/archived behind a discreet per-day toggle.
 *
 * Nothing is persisted in HHR/Firestore: it is a live read-only view, so the clinical text never
 * widens the app's data footprint. Requires the Ficha Médico tab (same requirement as the rest of
 * the Eloísa sync); degrades to an error state with retry.
 */

import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Loader2, RefreshCw, X } from 'lucide-react';
import {
  parseClinicalPanel,
  requestClinicalPanel,
  type ClinicalPanel,
  type EvolutionProfession,
} from '@/features/rayen-import';
import { EvolutionCard, IndicationDayCard } from './ClinicalPanelSections';

interface ClinicalPanelDrawerProps {
  bedId: string;
  patientName: string;
  clinicalEpisodeId: string;
  onClose: () => void;
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; panel: ClinicalPanel };

type PanelTab = 'evolutions' | 'indications';

const PROFESSION_TABS: { key: EvolutionProfession; label: string; empty: string }[] = [
  { key: 'medical', label: 'Médicas', empty: 'Sin evoluciones médicas en los últimos 14 días.' },
  {
    key: 'nursing',
    label: 'Enfermería',
    empty: 'Sin evoluciones de enfermería en los últimos 14 días.',
  },
  {
    key: 'other',
    label: 'Otros prof.',
    empty: 'Sin evoluciones de otros profesionales en los últimos 14 días.',
  },
];

export const ClinicalPanelDrawer: React.FC<ClinicalPanelDrawerProps> = ({
  bedId,
  patientName,
  clinicalEpisodeId,
  onClose,
}) => {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [tab, setTab] = useState<PanelTab>('evolutions');
  const [profession, setProfession] = useState<EvolutionProfession>('medical');

  // The initial state is already 'loading', so the mount effect only fetches (no sync setState);
  // `reload` (refresh/retry buttons) is the one that flips back to 'loading' first.
  const load = useCallback(async () => {
    const result = await requestClinicalPanel(clinicalEpisodeId);
    if (result.error && result.events.length === 0) {
      setState({ phase: 'error', message: result.error });
      return;
    }
    setState({ phase: 'ready', panel: parseClinicalPanel(result.events) });
  }, [clinicalEpisodeId]);

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetch-on-open; state only settles after the async response (same idiom as wound-care hooks)
    void load();
  }, [load]);

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

  const panel = state.phase === 'ready' ? state.panel : null;
  const professionCount = (key: EvolutionProfession): number =>
    panel ? panel.evolutions.filter(e => e.profession === key).length : 0;
  const visibleEvolutions = panel ? panel.evolutions.filter(e => e.profession === profession) : [];

  const tabButton = (key: PanelTab, label: string, count: number | null): React.ReactElement => (
    <button
      type="button"
      onClick={() => setTab(key)}
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
        role="dialog"
        aria-label={`Panel clínico de ${patientName}`}
        data-testid={`clinical-panel-drawer-${bedId}`}
        className="fixed right-0 top-0 z-[1101] flex h-full w-[430px] max-w-[92vw] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl"
      >
        <header className="flex items-start gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-bold text-slate-800">{patientName}</h2>
            <p className="text-[10px] text-slate-400">
              Cama {bedId} · Panel clínico Eloísa — vista en vivo, no se guarda en HHR
            </p>
          </div>
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
            panel ? panel.indicationDays.reduce((sum, day) => sum + day.active.length, 0) : null
          )}
        </nav>

        {tab === 'evolutions' && state.phase === 'ready' && (
          <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
            {PROFESSION_TABS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setProfession(p.key)}
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
                  {PROFESSION_TABS.find(p => p.key === profession)?.empty}
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
        </div>
      </aside>
    </>
  );
};
