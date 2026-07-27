import React from 'react';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';
import { formatIsoDay } from './scoresDetailTokens';

interface ScoresHistoryTableProps {
  history: EvaluationScoreEntry[];
}

const applicationDateTime = (entry: EvaluationScoreEntry): string => {
  const clock = entry.recordedAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  return `${formatIsoDay(entry.recordedDate)}${clock ? ` · ${String(Number(clock[1])).padStart(2, '0')}:${clock[2]}` : ''}`;
};

export const ScoresHistoryTable: React.FC<ScoresHistoryTableProps> = ({ history }) => {
  if (history.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-xs">
        <caption className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-500">
          Aplicaciones durante la hospitalización
        </caption>
        <thead className="text-slate-400">
          <tr>
            <th className="px-3 py-2 font-semibold">Escala y resultado</th>
            <th className="px-3 py-2 font-semibold">Fecha</th>
            <th className="px-3 py-2 font-semibold">Profesional</th>
          </tr>
        </thead>
        <tbody>
          {history.map(entry => (
            <tr
              key={`${entry.code}-${entry.encounterEventId}-${entry.sourceOrder ?? 0}`}
              className="border-t border-slate-100 text-slate-600"
            >
              <td className="whitespace-nowrap px-3 py-2">
                <strong className="text-slate-700">
                  {entry.code === 'BRADEN' ? 'Braden' : 'Downton'} · {entry.total ?? '—'}
                </strong>{' '}
                {entry.severity ?? 'Sin clasificación'}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {applicationDateTime(entry)}
              </td>
              <td
                className="px-3 py-2 font-medium text-slate-700"
                title={
                  entry.archived
                    ? 'Oculta del resumen rápido en Eloísa; sigue siendo una aplicación válida'
                    : undefined
                }
              >
                {entry.author || 'No informado'}
                {entry.archived && <span className="text-slate-400"> · Oculta</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
