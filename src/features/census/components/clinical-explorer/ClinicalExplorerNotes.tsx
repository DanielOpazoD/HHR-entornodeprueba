import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { BookOpenText, ClipboardList, RefreshCw } from 'lucide-react';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { useClinicalPanelSnapshot, type PanelState } from '../patient-row/useClinicalPanelSnapshot';
import { EvolutionCard } from '../patient-row/ClinicalPanelSections';
import {
  AreaCard,
  EXPLORER_ICON_BUTTON,
  EmptyNote,
  LinkButton,
  ReadFailure,
  SkeletonLines,
  type ClinicalExplorerTab,
} from './clinicalExplorerUi';

// Types come from the census hook, so the explorer needs no deep import of rayen-import.
type ClinicalPanel = Extract<PanelState, { phase: 'ready' }>['panel'];
type ClinicalPanelIndicationDay = ClinicalPanel['indicationDays'][number];
type ClinicalPanelEntry = ClinicalPanel['evolutions'][number];
type EvolutionProfession = NonNullable<ClinicalPanelEntry['profession']>;

const SOURCE = 'Eloísa · Ficha Médico';
const COMPACT_EVOLUTIONS = 3;
const EVOLUTION_BATCH = 20;

type ProfessionFilter = 'all' | EvolutionProfession;
const PROFESSIONS: ReadonlyArray<{ key: ProfessionFilter; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'medical', label: 'Médico' },
  { key: 'nursing', label: 'Enfermería' },
  { key: 'other', label: 'Otros' },
];

interface ClinicalExplorerNotesProps {
  children?: React.ReactNode;
  episodeId: string;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  tab: ClinicalExplorerTab;
  onShowAll: (tab: ClinicalExplorerTab) => void;
}

const IndicationLine: React.FC<{ entry: ClinicalPanelEntry; muted?: boolean }> = ({
  entry,
  muted = false,
}) => (
  <li
    className={clsx(
      'rounded-md border border-slate-100 px-2.5 py-1.5 text-[12px] leading-snug',
      muted ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700'
    )}
  >
    <span className="block font-medium">{entry.title}</span>
    {entry.text && <span className="block text-[11px] text-slate-500">{entry.text}</span>}
  </li>
);

const IndicationDay: React.FC<{ day: ClinicalPanelIndicationDay | undefined }> = ({ day }) => {
  const [showSuspended, setShowSuspended] = useState(false);
  const suspendedCount = day?.suspended.length ?? 0;
  return (
    <>
      {day && (day.active.length > 0 || (showSuspended && suspendedCount > 0)) ? (
        <ul className="flex flex-col gap-1">
          {day.active.map(entry => (
            <IndicationLine key={`${entry.kind}-${entry.id}`} entry={entry} />
          ))}
          {showSuspended &&
            day.suspended.map(entry => (
              <IndicationLine key={`${entry.kind}-${entry.id}`} entry={entry} muted />
            ))}
        </ul>
      ) : (
        <EmptyNote>
          {day
            ? 'Sin indicaciones vigentes para esta fecha.'
            : 'Sin indicaciones registradas para esta fecha.'}
        </EmptyNote>
      )}
      {suspendedCount > 0 && (
        <LinkButton
          className="!text-slate-500"
          aria-expanded={showSuspended}
          onClick={() => setShowSuspended(open => !open)}
        >
          {showSuspended
            ? 'Ocultar las suspendidas'
            : `Mostrar ${suspendedCount} ${suspendedCount === 1 ? 'suspendida' : 'suspendidas'}`}
        </LinkButton>
      )}
    </>
  );
};

/** Evolutions and indications read from Eloísa for the selected episode, one read for both. */
export const ClinicalExplorerNotes: React.FC<ClinicalExplorerNotesProps> = ({
  children,
  episodeId,
  selectedDate,
  onSelectDate,
  tab,
  onShowAll,
}) => {
  const { state, reload } = useClinicalPanelSnapshot(episodeId);
  const [profession, setProfession] = useState<ProfessionFilter>('all');
  const [historyPage, setHistoryPage] = useState({ episodeId, count: EVOLUTION_BATCH });
  if (historyPage.episodeId !== episodeId) {
    setHistoryPage({ episodeId, count: EVOLUTION_BATCH });
  }
  const panel = state.phase === 'ready' ? state.panel : null;
  const evolutions = panel
    ? panel.evolutions.filter(entry => profession === 'all' || entry.profession === profession)
    : [];
  const countFor = (key: ProfessionFilter): number =>
    panel ? panel.evolutions.filter(e => key === 'all' || e.profession === key).length : 0;
  const compact = tab === 'all';
  const shownLimit = compact
    ? COMPACT_EVOLUTIONS
    : historyPage.episodeId === episodeId
      ? historyPage.count
      : EVOLUTION_BATCH;
  const shownEvolutions = evolutions.slice(0, shownLimit);
  const [today, setToday] = useState(() => getClinicalCalendarDateISO());
  const indicationDate = selectedDate ?? today;
  const indicationDay = panel?.indicationDays.find(day => day.day === indicationDate);

  useEffect(() => {
    const refresh = (): void => setToday(getClinicalCalendarDateISO());
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const reloadButton = (
    <button
      type="button"
      onClick={reload}
      disabled={state.phase === 'loading'}
      className={EXPLORER_ICON_BUTTON}
      title="Volver a leer Ficha Médico"
      aria-label="Volver a leer Ficha Médico"
    >
      <RefreshCw size={13} aria-hidden="true" />
    </button>
  );

  const body = (render: () => React.ReactNode): React.ReactNode => {
    if (state.phase === 'loading') return <SkeletonLines label="Leyendo Ficha Médico" />;
    if (state.phase === 'error') return <ReadFailure message={state.message} onRetry={reload} />;
    return render();
  };

  return (
    <>
      {(tab === 'all' || tab === 'evolutions') && (
        <AreaCard
          icon={<BookOpenText />}
          title="Evoluciones"
          subtitle={panel ? `${panel.evolutions.length}` : undefined}
          source={SOURCE}
          actions={
            <>
              {compact && evolutions.length > COMPACT_EVOLUTIONS && (
                <LinkButton onClick={() => onShowAll('evolutions')}>Ver historial ›</LinkButton>
              )}
              {reloadButton}
            </>
          }
        >
          {body(() => (
            <>
              <div role="group" aria-label="Profesión" className="flex flex-wrap gap-1">
                {PROFESSIONS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={profession === item.key}
                    onClick={() => {
                      setProfession(item.key);
                      setHistoryPage({ episodeId, count: EVOLUTION_BATCH });
                    }}
                    className={clsx(
                      'min-h-9 rounded-lg px-2 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
                      profession === item.key
                        ? 'bg-teal-50 text-teal-800'
                        : 'text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    {item.label} ({countFor(item.key)})
                  </button>
                ))}
              </div>
              {shownEvolutions.length === 0 ? (
                <EmptyNote>
                  {panel && panel.evolutions.length > 0
                    ? 'Sin evoluciones para este filtro.'
                    : 'Sin evoluciones en Ficha Médico.'}
                </EmptyNote>
              ) : (
                <div className="divide-y divide-slate-100">
                  {shownEvolutions.map((entry, index) => (
                    <EvolutionCard key={entry.id} entry={entry} isLatest={index === 0} />
                  ))}
                </div>
              )}
              {!compact && evolutions.length > EVOLUTION_BATCH && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[12px] text-slate-500">
                  <span role="status">
                    Mostrando {shownEvolutions.length} de {evolutions.length}
                  </span>
                  {shownEvolutions.length < evolutions.length && (
                    <span className="flex items-center gap-3">
                      <LinkButton
                        onClick={() =>
                          setHistoryPage({ episodeId, count: shownLimit + EVOLUTION_BATCH })
                        }
                      >
                        Mostrar{' '}
                        {Math.min(EVOLUTION_BATCH, evolutions.length - shownEvolutions.length)} más
                      </LinkButton>
                      <LinkButton
                        className="!text-slate-500"
                        onClick={() => setHistoryPage({ episodeId, count: evolutions.length })}
                      >
                        Mostrar todas
                      </LinkButton>
                    </span>
                  )}
                </div>
              )}
            </>
          ))}
        </AreaCard>
      )}
      {children}
      {(tab === 'all' || tab === 'indications') && (
        <AreaCard
          icon={<ClipboardList />}
          title="Indicaciones"
          className={compact ? 'xl:col-span-2' : undefined}
          subtitle={panel ? `${indicationDay?.active.length ?? 0} vigentes` : undefined}
          source={SOURCE}
          actions={tab === 'indications' ? reloadButton : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="Fecha de indicaciones"
              value={indicationDate}
              max={today}
              onChange={event => onSelectDate(event.target.value || null)}
              className="h-7 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[12px] tabular-nums text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
            />
            <button
              type="button"
              aria-pressed={selectedDate === null}
              onClick={() => {
                setToday(getClinicalCalendarDateISO());
                onSelectDate(null);
              }}
              className="h-7 rounded-md px-2 text-[11px] font-semibold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
            >
              Hoy
            </button>
          </div>
          {body(() => (
            <IndicationDay key={indicationDate} day={indicationDay} />
          ))}
        </AreaCard>
      )}
    </>
  );
};
