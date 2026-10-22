import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Timer } from 'lucide-react';
import type { FunctionsTelemetryEntry } from '@/types/functionsTelemetry';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

interface Props {
  entries: FunctionsTelemetryEntry[];
}

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      timeZone: CLINICAL_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
};

const statusBadge = (status: FunctionsTelemetryEntry['status']) => {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
        <CheckCircle2 size={12} />
        Éxito
      </span>
    );
  }
  if (status === 'timeout') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded">
        <Timer size={12} />
        Timeout
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
      <AlertCircle size={12} />
      Falla
    </span>
  );
};

const TelemetryRow: React.FC<{ entry: FunctionsTelemetryEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.errorMessage || entry.context;

  return (
    <>
      <tr
        className={`border-b border-slate-100 hover:bg-slate-50 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(v => !v)}
      >
        <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">
          {hasDetails ? (
            expanded ? (
              <ChevronDown size={12} className="inline mr-1" />
            ) : (
              <ChevronRight size={12} className="inline mr-1" />
            )
          ) : (
            <span className="inline-block w-3 mr-1" />
          )}
          {formatDate(entry.timestamp)}
        </td>
        <td className="py-2 px-3 text-xs font-semibold text-slate-700">{entry.service}</td>
        <td className="py-2 px-3 text-xs text-slate-600">{entry.operation}</td>
        <td className="py-2 px-3">{statusBadge(entry.status)}</td>
        <td className="py-2 px-3 text-xs text-slate-500 text-right">{entry.durationMs} ms</td>
        <td className="py-2 px-3 text-xs text-slate-500 text-right">
          {entry.attempt}/{entry.totalAttempts}
        </td>
        <td className="py-2 px-3 text-xs text-slate-500">{entry.errorCode ?? '—'}</td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={7} className="py-3 px-4">
            {entry.errorMessage && (
              <div className="mb-2">
                <div className="text-xs font-semibold text-slate-500 mb-1">Error</div>
                <div className="text-xs text-rose-700 bg-white rounded px-2 py-1.5 border border-rose-100 font-mono">
                  {entry.errorMessage}
                </div>
              </div>
            )}
            {entry.context && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">Contexto</div>
                <pre className="text-xs text-slate-700 bg-white rounded px-2 py-1.5 border border-slate-200 overflow-x-auto">
                  {JSON.stringify(entry.context, null, 2)}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

export const FunctionsTelemetryTable: React.FC<Props> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center text-slate-500">
        <p className="text-sm">Sin resultados con los filtros actuales.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-left uppercase tracking-wide">
                Timestamp
              </th>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-left uppercase tracking-wide">
                Servicio
              </th>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-left uppercase tracking-wide">
                Operación
              </th>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-left uppercase tracking-wide">
                Estado
              </th>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-right uppercase tracking-wide">
                Duración
              </th>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-right uppercase tracking-wide">
                Intento
              </th>
              <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-left uppercase tracking-wide">
                Código
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <TelemetryRow key={entry.id} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
        Mostrando {entries.length} invocaciones.
      </div>
    </div>
  );
};
