import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { clearErrorLogs, fetchErrorLogs } from '@/services/errorLogService';
import type { ErrorLog, ErrorSeverity } from '@/services/logging/errorLogTypes';

const PRIVATE_CONTEXT_KEYS = new Set(['patient', 'patientname', 'rut', 'diagnosis', 'diagnostico']);

const severityLabel: Record<ErrorSeverity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Critica',
};

const severityClassName: Record<ErrorSeverity, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  critical: 'bg-red-600 text-white border-red-600',
};

const toReadableDateTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const toRoute = (url?: string): string => {
  if (!url) return 'Sin ruta';
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url.startsWith('/') ? url : 'Sin ruta';
  }
};

const stringifyContextValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildContextRows = (context?: Record<string, unknown>) => {
  if (!context) return [];
  return Object.entries(context)
    .filter(([key]) => !PRIVATE_CONTEXT_KEYS.has(key.toLowerCase()))
    .map(([key, value]) => `${key}: ${stringifyContextValue(value)}`)
    .filter(row => row.trim().length > 0)
    .slice(0, 6);
};

const pluralizeLogCount = (count: number): string =>
  `${count} ${count === 1 ? 'registro' : 'registros'}`;

export const LocalErrorLogsView: React.FC = () => {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setLogs(await fetchErrorLogs(100));
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const severityCounts = useMemo(
    () =>
      logs.reduce(
        (counts, log) => ({
          ...counts,
          [log.severity]: (counts[log.severity] || 0) + 1,
        }),
        {} as Record<ErrorSeverity, number>
      ),
    [logs]
  );

  const handleClear = async () => {
    setClearing(true);
    setLoadError(null);
    try {
      await clearErrorLogs();
      await loadLogs();
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600 border border-rose-100">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Errores locales</h1>
            <p className="text-xs text-slate-500">
              Logs técnicos guardados en este navegador para soporte y depuración.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadLogs()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refrescar
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-60"
            disabled={clearing || logs.length === 0}
          >
            <Trash2 size={14} />
            Limpiar
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Total</p>
          <p className="text-lg font-bold text-slate-800">{pluralizeLogCount(logs.length)}</p>
        </div>
        {(['critical', 'high', 'medium', 'low'] as ErrorSeverity[]).map(severity => (
          <div key={severity} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-slate-400">
              {severityLabel[severity]}
            </p>
            <p className="text-lg font-bold text-slate-800">{severityCounts[severity] || 0}</p>
          </div>
        ))}
      </section>

      {loadError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">
          Cargando errores locales...
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
          <p className="font-semibold text-slate-700">No hay errores locales registrados.</p>
          <p className="mt-1 text-sm text-slate-500">
            Si ocurre un error técnico en este navegador, aparecerá aquí al refrescar.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => (
            <article
              key={log.id}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${severityClassName[log.severity]}`}
                    >
                      {severityLabel[log.severity]}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      {toReadableDateTime(log.timestamp)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {toRoute(log.url)}
                    </span>
                  </div>
                  <h2 className="break-words text-sm font-bold text-slate-900">{log.message}</h2>
                </div>
                <code className="break-all rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                  {log.id}
                </code>
              </div>

              {buildContextRows(log.context).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {buildContextRows(log.context).map(row => (
                    <span
                      key={row}
                      className="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200"
                    >
                      {row}
                    </span>
                  ))}
                </div>
              )}

              {log.stack && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    Stack técnico
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                    {log.stack}
                  </pre>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
