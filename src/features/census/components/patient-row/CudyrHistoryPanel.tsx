import type { CudyrCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import { useEloisaStaff } from '@/hooks/useEloisaStaff';
import { formatStaffDisplayName } from '@/services/staff/staffDisplayName';
import { nursingRole } from '@/services/staff/eloisaStaffIdentity';
import { CudyrCard } from './ScoresDetailCards';
import { formatIsoDay } from './scoresDetailTokens';

const dateTime = (value: string | undefined, day: string) => {
  if (!value || !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value)) {
    const clock = value?.match(/[T ](\d{2}:\d{2})/)?.[1];
    return `${formatIsoDay(day)}${clock ? ` · ${clock}` : ''}`;
  }
  const epoch = Date.parse(value);
  return Number.isNaN(epoch)
    ? formatIsoDay(day)
    : new Intl.DateTimeFormat('es-CL', {
        timeZone: 'Pacific/Easter',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(epoch));
};

export const CudyrHistoryPanel = ({
  cudyr,
  entry,
}: {
  cudyr: CudyrCellModel | null;
  entry: ImportedCudyr;
}) => {
  const professionals = useEloisaStaff();
  const history = entry.history?.length ? entry.history : [entry];
  const official = entry.source.includes('Gestión de Camas');
  return (
    <div className="space-y-2">
      {cudyr && <CudyrCard cudyr={cudyr} />}
      <p className="text-xs text-slate-500">
        Fuente: {entry.source || 'No informada'} ·{' '}
        {official ? 'historial oficial.' : 'último valor disponible, no historial completo.'}
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <caption className="bg-slate-50 px-3 py-1.5 text-left font-semibold text-slate-500">
            {official ? 'Historial CUDYR oficial' : 'Último CUDYR disponible'}
          </caption>
          <thead className="text-slate-500">
            <tr>
              {['Resultado', 'Fecha', 'Profesional', 'Evidencia'].map(label => (
                <th key={label} className="px-3 py-1.5 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((entry, index) => (
              <tr
                key={`${entry.recordedAt}-${index}`}
                className="border-t border-slate-100 text-slate-600"
              >
                <td className="px-3 py-1.5 align-top">
                  <strong>{entry.category}</strong>
                  {entry.dependencyScore != null && entry.riskScore != null && (
                    <div className="text-[11px] text-slate-500">
                      Dependencia {entry.dependencyScore} · Riesgo {entry.riskScore}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 align-top tabular-nums">
                  {dateTime(entry.recordedAt, entry.recordedDate)}
                </td>
                <td className="px-3 py-1.5 align-top" title={entry.author}>
                  {entry.author
                    ? formatStaffDisplayName(
                        entry.author,
                        professionals,
                        nursingRole(entry.authorRole ?? '')
                      )
                    : 'No informado'}
                </td>
                <td className="px-3 py-1.5 align-top text-[11px]">
                  {entry.author ? 'Firma sincronizada' : 'Sin firma informada'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
