import React from 'react';
import clsx from 'clsx';
import { EyeOff, History } from 'lucide-react';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';
import { formatIsoDay, severityLevel, tokensFor } from './scoresDetailTokens';

interface ScoresHistoryTableProps {
  history: EvaluationScoreEntry[];
}

const LABEL: Record<EvaluationScoreEntry['code'], string> = {
  BRADEN: 'Braden',
  DOWNTON: 'Downton',
};

const applicationDateTime = (entry: EvaluationScoreEntry): string => {
  const clock = entry.recordedAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  return `${formatIsoDay(entry.recordedDate)}${clock ? ` · ${String(Number(clock[1])).padStart(2, '0')}:${clock[2]}` : ''}`;
};

export const ScoresHistoryTable: React.FC<ScoresHistoryTableProps> = ({ history }) => {
  if (history.length === 0) return null;
  const ordered = history
    .slice()
    .sort(
      (a, b) =>
        b.encounterEventId - a.encounterEventId || (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0)
    );

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <h4 className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <History size={13} /> Aplicaciones durante la hospitalización
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="bg-white text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Escala</th>
              <th className="px-3 py-2 font-semibold">Fecha</th>
              <th className="px-3 py-2 font-semibold">Resultado</th>
              <th className="px-3 py-2 font-semibold">Profesional</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ordered.map(entry => {
              const tokens = tokensFor(severityLevel(entry.severity));
              return (
                <tr
                  key={`${entry.code}-${entry.encounterEventId}-${entry.sourceOrder ?? 0}`}
                  className="text-slate-600"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700">
                    {LABEL[entry.code]}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {applicationDateTime(entry)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={clsx('h-2 w-2 rounded-full', tokens.dot)} />
                      <strong className="tabular-nums text-slate-700">{entry.total ?? '—'}</strong>
                      <span>{entry.severity ?? 'Sin clasificación'}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-700">
                      {entry.author || 'No informado'}
                    </div>
                    {entry.authorRole && (
                      <div className="text-[10px] text-slate-400">{entry.authorRole}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {entry.archived ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                        title="Oculta del resumen rápido en Eloísa; sigue siendo una aplicación válida"
                      >
                        <EyeOff size={11} /> Oculta
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-emerald-600">Visible</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
