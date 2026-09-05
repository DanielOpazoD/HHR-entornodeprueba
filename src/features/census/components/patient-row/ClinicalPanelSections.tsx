/**
 * Presentational pieces of the ClinicalPanelDrawer (kept separate for the module-size budget):
 *   - EvolutionCard: one evolution / shift-change note, with the AUTHOR (person + role) up front.
 *   - IndicationDayCard: one calendar day of the indication sheet — active items as a compact
 *     list in clinical order, suspended/archived ones tucked behind a discreet toggle.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, ChevronRight, CircleOff, Clock3, TriangleAlert } from 'lucide-react';
import type {
  ClinicalPanelCareActionStatus,
  ClinicalPanelCareDay,
  ClinicalPanelEntry,
  ClinicalPanelIndicationDay,
  EvolutionProfession,
} from '@/features/rayen-import';

/** Soft role-chip color per profession bucket, so the author's discipline reads without shouting. */
const PROFESSION_CHIP: Record<EvolutionProfession, string> = {
  medical: 'bg-sky-50 text-sky-600 ring-sky-100',
  nursing: 'bg-rose-50 text-rose-500 ring-rose-100',
  other: 'bg-violet-50 text-violet-500 ring-violet-100',
};

const pad = (n: number): string => String(n).padStart(2, '0');

export const formatWhen = (raw: string): string => {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  const d = new Date(t);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatTime = (raw: string): string => {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const INDICATION_KIND_LABEL: Partial<Record<ClinicalPanelEntry['kind'], string>> = {
  diet: 'Régimen',
  rest: 'Reposo',
  pharma: 'Fármaco',
  'free-indication': 'Indicación',
};

export const EvolutionCard: React.FC<{ entry: ClinicalPanelEntry }> = ({ entry }) => {
  // Only an ANNULLED (crossed-out) note is dimmed. Archived notes keep normal styling — just the
  // "Archivada" tag — since being superseded doesn't make the text less readable.
  return (
    <article
      className={clsx(
        'rounded-lg border border-slate-200/80 bg-white p-3',
        entry.crossedOut && 'opacity-60'
      )}
    >
      <header className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[12px] font-semibold text-slate-700">
          {entry.author || entry.role || 'Sin autor'}
        </span>
        {entry.author && entry.role && (
          <span
            className={clsx(
              'rounded px-1 py-px text-[9px] font-medium ring-1',
              PROFESSION_CHIP[entry.profession ?? 'other']
            )}
          >
            {entry.role}
          </span>
        )}
        {entry.kind === 'shift-change' && (
          <span className="rounded border border-slate-300 bg-slate-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-600">
            Entrega turno
          </span>
        )}
        {(entry.archived || entry.crossedOut) && (
          <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase text-slate-600">
            {entry.crossedOut ? 'Anulada' : 'Archivada'}
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-slate-500">
          {formatWhen(entry.publishedAt)}
        </span>
      </header>
      <p
        className={clsx(
          'mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700',
          entry.crossedOut && 'line-through decoration-slate-400'
        )}
      >
        {entry.text}
      </p>
    </article>
  );
};

const IndicationLine: React.FC<{ entry: ClinicalPanelEntry; muted?: boolean }> = ({
  entry,
  muted = false,
}) => (
  <li
    className={clsx(
      'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-1.5 rounded px-1 py-0.5 text-[12px] leading-snug',
      muted ? 'bg-slate-50 text-slate-500' : 'text-slate-700'
    )}
    title={[entry.author, entry.role, formatTime(entry.publishedAt)].filter(Boolean).join(' · ')}
  >
    <span className="mt-0.5 rounded bg-slate-100 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-slate-500">
      {INDICATION_KIND_LABEL[entry.kind]}
    </span>
    <span className={clsx('min-w-0', muted && 'line-through decoration-slate-400')}>
      <span className="block font-semibold text-slate-700">{entry.title}</span>
      {entry.text && <span className="block text-[11px] text-slate-500">{entry.text}</span>}
    </span>
    {!muted && entry.kind === 'pharma' && entry.validitySource === 'daily-validation' && (
      <span
        className="shrink-0 rounded bg-emerald-50 px-1 py-px text-[8px] font-bold uppercase text-emerald-700 ring-1 ring-emerald-200"
        title={`Vigente por validación diaria del tratamiento${entry.prescribedAt ? ` · indicada el ${formatWhen(entry.prescribedAt)}` : ''}`}
      >
        Vigente
      </span>
    )}
    {muted && (
      <span
        className={clsx(
          'shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase',
          entry.suspended ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'
        )}
      >
        {entry.finalized ? 'Finalizada' : entry.suspended ? 'Suspendida' : 'Archivada'}
      </span>
    )}
  </li>
);

export const IndicationDayCard: React.FC<{ day: ClinicalPanelIndicationDay }> = ({ day }) => {
  const [showSuspended, setShowSuspended] = useState(false);
  return (
    <section className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <h3 className="mb-1 flex items-center justify-between border-b border-slate-100 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <span>{day.label}</span>
        <span className="text-[9px] font-medium normal-case text-slate-400">
          {day.active.length} activas
        </span>
      </h3>
      {day.active.length > 0 ? (
        <ul className="space-y-1">
          {day.active.map(entry => (
            <IndicationLine key={`${entry.kind}-${entry.id}`} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] italic text-slate-400">Sin indicaciones activas este día.</p>
      )}
      {day.suspended.length > 0 && (
        <div className="mt-1.5 border-t border-slate-100 pt-1">
          <button
            type="button"
            onClick={() => setShowSuspended(open => !open)}
            className="flex items-center gap-0.5 text-[10px] font-medium text-slate-400 transition-colors hover:text-slate-600"
            aria-expanded={showSuspended}
          >
            <ChevronRight
              size={11}
              className={clsx('transition-transform', showSuspended && 'rotate-90')}
            />
            {day.suspended.length} {day.suspended.length === 1 ? 'inactiva' : 'inactivas'}
          </button>
          {showSuspended && (
            <ul className="mt-1 space-y-1">
              {day.suspended.map(entry => (
                <IndicationLine key={`${entry.kind}-${entry.id}`} entry={entry} muted />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

const CARE_STATUS: Record<
  ClinicalPanelCareActionStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  performed: {
    label: 'Ejecutada',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: <CheckCircle2 size={11} />,
  },
  'outside-plan': {
    label: 'Ejecutada fuera de plan',
    className: 'bg-amber-50 text-amber-700 ring-amber-200',
    icon: <TriangleAlert size={11} />,
  },
  'not-performed': {
    label: 'No ejecutada',
    className: 'bg-red-50 text-red-700 ring-red-200',
    icon: <CircleOff size={11} />,
  },
  pending: {
    label: 'Pendiente',
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
    icon: <Clock3 size={11} />,
  },
  suspended: {
    label: 'Suspendida',
    className: 'bg-slate-100 text-slate-500 ring-slate-200',
    icon: <CircleOff size={11} />,
  },
};

export const CareDayCard: React.FC<{ day: ClinicalPanelCareDay }> = ({ day }) => {
  const executed = day.actions.filter(
    action => action.status === 'performed' || action.status === 'outside-plan'
  ).length;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <h3 className="mb-1.5 flex items-center justify-between border-b border-slate-100 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <span>{day.label}</span>
        <span className="text-[9px] font-medium normal-case text-emerald-600">
          {executed}/{day.actions.length} ejecutadas
        </span>
      </h3>
      <ul className="space-y-1">
        {day.actions.map(action => {
          const status = CARE_STATUS[action.status];
          return (
            <li key={action.id} className="rounded border border-slate-100 bg-slate-50/70 p-1.5">
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-slate-700">
                  {action.title}
                </span>
                <span
                  className={clsx(
                    'inline-flex shrink-0 items-center gap-1 rounded px-1 py-px text-[9px] font-bold ring-1',
                    status.className
                  )}
                >
                  {status.icon}
                  {status.label}
                </span>
              </div>
              {(action.detail || action.schedule) && (
                <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  {[action.detail, action.schedule].filter(Boolean).join(' · ')}
                </p>
              )}
              {(action.author || action.performedAt) && (
                <p className="mt-0.5 text-right text-[9px] text-slate-400">
                  {[action.author, formatWhen(action.performedAt)].filter(Boolean).join(' · ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
