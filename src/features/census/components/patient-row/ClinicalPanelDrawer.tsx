/**
 * ClinicalPanelDrawer — "Panel clínico" del paciente (vista Eloísa en vivo).
 *
 * Right-side drawer with two tabs — Evoluciones (médicas + entrega de turno de enfermería) and
 * Indicaciones (farmacológicas, libres, régimen y reposo) — fetched ON DEMAND from Ficha Médico via
 * the extension when the drawer opens. Nothing is persisted in HHR/Firestore: it is a live read-only
 * view, so the clinical text never widens the app's data footprint. Requires the Ficha Médico tab
 * (same requirement as the rest of the Eloísa sync); degrades to an error state with retry.
 */

import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Loader2, RefreshCw, X } from 'lucide-react';
import {
  parseClinicalPanel,
  requestClinicalPanel,
  type ClinicalPanel,
  type ClinicalPanelEntry,
} from '@/features/rayen-import';

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

const KIND_STYLES: Record<ClinicalPanelEntry['kind'], { label: string; className: string }> = {
  evolution: { label: 'Evolución', className: 'border-sky-300 bg-sky-50 text-sky-700' },
  'shift-change': { label: 'Entrega turno', className: 'border-pink-300 bg-pink-50 text-pink-700' },
  pharma: { label: 'Fármaco', className: 'border-indigo-300 bg-indigo-50 text-indigo-700' },
  'free-indication': {
    label: 'Indicación',
    className: 'border-slate-300 bg-slate-50 text-slate-600',
  },
  diet: { label: 'Régimen', className: 'border-amber-300 bg-amber-50 text-amber-700' },
  rest: { label: 'Reposo', className: 'border-teal-300 bg-teal-50 text-teal-700' },
};

const pad = (n: number): string => String(n).padStart(2, '0');

const formatWhen = (raw: string): string => {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  const d = new Date(t);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EntryCard: React.FC<{ entry: ClinicalPanelEntry }> = ({ entry }) => {
  const kind = KIND_STYLES[entry.kind];
  const inactive = entry.archived || entry.suspended || entry.crossedOut;
  return (
    <article
      className={clsx(
        'rounded-md border border-slate-200 bg-white p-2 shadow-sm',
        inactive && 'opacity-60'
      )}
    >
      <header className="flex flex-wrap items-center gap-1.5">
        <span
          className={clsx(
            'rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wide',
            kind.className
          )}
        >
          {kind.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">
          {entry.title}
        </span>
        {entry.isNew && !entry.suspended && (
          <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-bold uppercase text-emerald-700">
            Nueva
          </span>
        )}
        {entry.suspended && (
          <span className="rounded bg-red-100 px-1 py-px text-[9px] font-bold uppercase text-red-700">
            Suspendida
          </span>
        )}
        {(entry.archived || entry.crossedOut) && (
          <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase text-slate-600">
            {entry.crossedOut ? 'Anulada' : 'Archivada'}
          </span>
        )}
      </header>
      {entry.text && (
        <p
          className={clsx(
            'mt-1 whitespace-pre-wrap text-[12px] leading-snug text-slate-700',
            entry.crossedOut && 'line-through decoration-slate-400'
          )}
        >
          {entry.text}
        </p>
      )}
      <footer className="mt-1 text-[10px] text-slate-400">
        {[entry.author, formatWhen(entry.publishedAt)].filter(Boolean).join(' · ')}
      </footer>
    </article>
  );
};

export const ClinicalPanelDrawer: React.FC<ClinicalPanelDrawerProps> = ({
  bedId,
  patientName,
  clinicalEpisodeId,
  onClose,
}) => {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [tab, setTab] = useState<PanelTab>('evolutions');

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

  const entries =
    state.phase === 'ready'
      ? tab === 'evolutions'
        ? state.panel.evolutions
        : state.panel.indications
      : [];

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
          {tabButton(
            'evolutions',
            'Evoluciones',
            state.phase === 'ready' ? state.panel.evolutions.length : null
          )}
          {tabButton(
            'indications',
            'Indicaciones',
            state.phase === 'ready' ? state.panel.indications.length : null
          )}
        </nav>

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
          {state.phase === 'ready' && entries.length === 0 && (
            <p className="py-10 text-center text-[12px] italic text-slate-400">
              Sin registros en los últimos 14 días.
            </p>
          )}
          {entries.map(entry => (
            <EntryCard key={`${entry.kind}-${entry.id}`} entry={entry} />
          ))}
        </div>
      </aside>
    </>
  );
};
