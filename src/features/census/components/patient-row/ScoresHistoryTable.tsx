import React from 'react';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';
import { formatIsoDay } from './scoresDetailTokens';
import { useEloisaStaff } from '@/hooks/useEloisaStaff';
import { nursingRole, resolveEloisaStaffName } from '@/services/staff/eloisaStaffIdentity';

interface ScoresHistoryTableProps {
  history: EvaluationScoreEntry[];
}

const applicationDateTime = (entry: EvaluationScoreEntry): string => {
  const clock = entry.recordedAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const time = clock
    ? [String(Number(clock[1])).padStart(2, '0'), clock[2], clock[3]]
        .filter((part): part is string => part != null)
        .join(':')
    : null;
  return `${formatIsoDay(entry.recordedDate)}${time ? ` · ${time}` : ''}`;
};

export const ScoresHistoryTable: React.FC<ScoresHistoryTableProps> = ({ history }) => {
  const professionals = useEloisaStaff();
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
              <td className="px-3 py-2 align-top">
                <strong className="text-slate-700">
                  {entry.code === 'BRADEN' ? 'Braden' : 'Downton'} · {entry.total ?? '—'}
                </strong>{' '}
                {entry.severity ?? 'Sin clasificación'}
                {entry.archived && (
                  <div className="mt-0.5 text-[10px] text-slate-500">Archivada</div>
                )}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{applicationDateTime(entry)}</td>
              <td
                className="px-3 py-2 align-top font-medium text-slate-700"
                title={
                  entry.archived
                    ? 'Oculta del resumen rápido en Eloísa; sigue siendo una aplicación válida'
                    : undefined
                }
              >
                {entry.author
                  ? resolveEloisaStaffName(
                      entry.author,
                      professionals,
                      nursingRole(entry.authorRole ?? '')
                    )
                  : 'No informado'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
