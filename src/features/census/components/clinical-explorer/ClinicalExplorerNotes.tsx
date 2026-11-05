import React, { useState } from 'react';
import clsx from 'clsx';
import { BookOpenText, ClipboardList, RefreshCw } from 'lucide-react';
import { resolveCompactIndicationDays } from '@/features/census/controllers/clinicalExplorerController';
import { useClinicalPanelSnapshot, type PanelState } from '../patient-row/useClinicalPanelSnapshot';
import { EvolutionCard } from '../patient-row/ClinicalPanelSections';
import {
  AreaCard,
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
const COMPACT_INDICATION_DAYS = 2;

type ProfessionFilter = 'all' | EvolutionProfession;
const PROFESSIONS: ReadonlyArray<{ key: ProfessionFilter; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'medical', label: 'Médico' },
  { key: 'nursing', label: 'Enfermería' },
  { key: 'other', label: 'Otros' },
];

interface ClinicalExplorerNotesProps {
  episodeId: string;
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

const IndicationDays: React.FC<{ days: ClinicalPanelIndicationDay[]; compact: boolean }> = ({
  days,
  compact,
}) => {
  const [showSuspended, setShowSuspended] = useState(false);
  const baseDays = compact ? resolveCompactIndicationDays(days, COMPACT_INDICATION_DAYS) : days;
  const suspendedCount = baseDays.reduce((total, day) => total + day.suspended.length, 0);
  const shown = baseDays.filter(
    day => day.active.length > 0 || (showSuspended && day.suspended.length > 0)
  );
  return (
    <>
      {shown.map(day => (
        <div key={day.day} className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold tabular-nums text-slate-600">{day.label}</h4>
          <ul className="flex flex-col gap-1">
            {day.active.map(entry => (
              <IndicationLine key={`${entry.kind}-${entry.id}`} entry={entry} />
            ))}
            {showSuspended &&
              day.suspended.map(entry => (
                <IndicationLine key={`${entry.kind}-${entry.id}`} entry={entry} muted />
              ))}
          </ul>
        </div>
      ))}
      {shown.length === 0 && <EmptyNote>Sin indicaciones vigentes en Ficha Médico.</EmptyNote>}
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
  episodeId,
  tab,
  onShowAll,
}) => {
  const { state, reload } = useClinicalPanelSnapshot(episodeId);
  const [profession, setProfession] = useState<ProfessionFilter>('all');
  const panel = state.phase === 'ready' ? state.panel : null;
  const evolutions = panel
    ? panel.evolutions.filter(entry => profession === 'all' || entry.profession === profession)
    : [];
  const countFor = (key: ProfessionFilter): number =>
    panel ? panel.evolutions.filter(e => key === 'all' || e.profession === key).length : 0;
  const compact = tab === 'all';
  const shownEvolutions = compact ? evolutions.slice(0, COMPACT_EVOLUTIONS) : evolutions;
  const activeIndications = panel
    ? panel.indicationDays.reduce((total, day) => total + day.active.length, 0)
    : 0;
  const hasMoreIndicationDays = panel
    ? panel.indicationDays.length >
      resolveCompactIndicationDays(panel.indicationDays, COMPACT_INDICATION_DAYS).length
    : false;

  const reloadButton = (
    <button
      type="button"
      onClick={reload}
      disabled={state.phase === 'loading'}
      className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-50"
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
          iconClassName="bg-medical-50 text-medical-700"
          title="Evoluciones"
          subtitle={panel ? `${panel.evolutions.length}` : undefined}
          source={SOURCE}
          actions={
            <>
              {compact && evolutions.length > COMPACT_EVOLUTIONS && (
                <LinkButton onClick={() => onShowAll('evolutions')}>Ver todas ›</LinkButton>
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
                    onClick={() => setProfession(item.key)}
                    className={clsx(
                      'h-6 rounded-md px-2 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
                      profession === item.key
                        ? 'bg-medical-50 text-medical-700'
                        : 'text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    {item.label} ({countFor(item.key)})
                  </button>
                ))}
              </div>
              {shownEvolutions.length === 0 ? (
                <EmptyNote>Sin evoluciones en Ficha Médico.</EmptyNote>
              ) : (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-100">
                  {shownEvolutions.map((entry, index) => (
                    <EvolutionCard key={entry.id} entry={entry} isLatest={index === 0} />
                  ))}
                </div>
              )}
            </>
          ))}
        </AreaCard>
      )}
      {(tab === 'all' || tab === 'indications') && (
        <AreaCard
          icon={<ClipboardList />}
          iconClassName="bg-teal-50 text-teal-700"
          title="Indicaciones"
          subtitle={panel ? `${activeIndications} vigentes` : undefined}
          source={SOURCE}
          actions={
            <>
              {compact && hasMoreIndicationDays && (
                <LinkButton onClick={() => onShowAll('indications')}>Ver todas ›</LinkButton>
              )}
              {tab === 'indications' && reloadButton}
            </>
          }
        >
          {body(() => (
            <IndicationDays days={panel!.indicationDays} compact={compact} />
          ))}
        </AreaCard>
      )}
    </>
  );
};
