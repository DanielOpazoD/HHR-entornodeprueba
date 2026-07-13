/**
 * Presentational pieces of the ClinicalPanelDrawer (kept separate for the module-size budget):
 *   - EvolutionCard: one evolution / shift-change note, with the AUTHOR (person + role) up front.
 *   - IndicationDayCard: one calendar day of the indication sheet — active items as a compact
 *     list in clinical order, suspended/archived ones tucked behind a discreet toggle.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { ClinicalPanelEntry, ClinicalPanelIndicationDay } from '@/features/rayen-import';

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

export const EvolutionCard: React.FC<{ entry: ClinicalPanelEntry }> = ({ entry }) => {
  const inactive = entry.archived || entry.crossedOut;
  return (
    <article
      className={clsx(
        'rounded-md border border-slate-200 bg-white p-2 shadow-sm',
        inactive && 'opacity-60'
      )}
    >
      <header className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[12px] font-semibold text-slate-700">
          {entry.author || entry.role || 'Sin autor'}
        </span>
        {entry.author && entry.role && (
          <span className="text-[10px] text-slate-400">{entry.role}</span>
        )}
        {entry.kind === 'shift-change' && (
          <span className="rounded border border-pink-300 bg-pink-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-pink-700">
            Entrega turno
          </span>
        )}
        {(entry.archived || entry.crossedOut) && (
          <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase text-slate-600">
            {entry.crossedOut ? 'Anulada' : 'Archivada'}
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-slate-400">
          {formatWhen(entry.publishedAt)}
        </span>
      </header>
      <p
        className={clsx(
          'mt-1 whitespace-pre-wrap text-[12px] leading-snug text-slate-700',
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
    className={clsx('flex items-baseline gap-1.5 text-[12px] leading-snug', muted && 'opacity-60')}
    title={[entry.author, entry.role, formatTime(entry.publishedAt)].filter(Boolean).join(' · ')}
  >
    <span className="mt-px shrink-0 text-slate-300">•</span>
    <span className={clsx('min-w-0', muted && 'line-through decoration-slate-400')}>
      <span className="font-semibold text-slate-700">{entry.title}</span>
      {entry.text && <span className="text-slate-600"> — {entry.text}</span>}
    </span>
    {entry.isNew && !muted && (
      <span className="ml-auto shrink-0 rounded bg-emerald-100 px-1 py-px text-[9px] font-bold uppercase text-emerald-700">
        Nueva
      </span>
    )}
  </li>
);

export const IndicationDayCard: React.FC<{ day: ClinicalPanelIndicationDay }> = ({ day }) => {
  const [showSuspended, setShowSuspended] = useState(false);
  return (
    <section className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <h3 className="mb-1 border-b border-slate-100 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {day.label}
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
            {day.suspended.length}{' '}
            {day.suspended.length === 1 ? 'suspendida/archivada' : 'suspendidas/archivadas'}
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
