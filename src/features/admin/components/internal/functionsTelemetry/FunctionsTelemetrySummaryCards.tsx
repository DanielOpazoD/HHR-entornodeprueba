import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Timer } from 'lucide-react';
import type { FunctionsTelemetryServiceSummary } from '@/types/functionsTelemetry';

interface Props {
  summaries: FunctionsTelemetryServiceSummary[];
}

const formatPct = (value: number) => `${Math.round(value * 100)}%`;
const formatDate = (iso?: string) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const getErrorTone = (errorRate: number) => {
  if (errorRate >= 0.2) return 'bg-rose-50 border-rose-200 text-rose-700';
  if (errorRate >= 0.05) return 'bg-amber-50 border-amber-200 text-amber-700';
  return 'bg-emerald-50 border-emerald-200 text-emerald-700';
};

export const FunctionsTelemetrySummaryCards: React.FC<Props> = ({ summaries }) => {
  if (summaries.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center text-slate-500">
        <Activity size={32} className="mx-auto mb-2 text-slate-300" />
        <p className="text-sm">Sin telemetría registrada aún.</p>
        <p className="text-xs text-slate-400 mt-1">
          Los registros aparecerán cuando se invoquen Functions con observabilidad.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
      {summaries.map(summary => (
        <div
          key={summary.service}
          className={`rounded-2xl shadow-sm border p-4 ${getErrorTone(summary.errorRate)}`}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wide">{summary.service}</h3>
            {summary.errorRate >= 0.2 ? (
              <AlertTriangle size={18} />
            ) : summary.errorRate >= 0.05 ? (
              <AlertTriangle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="opacity-70">Invocaciones</span>
              <span className="font-semibold">{summary.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Tasa de error</span>
              <span className="font-semibold">{formatPct(summary.errorRate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70 flex items-center gap-1">
                <Timer size={10} />
                Latencia media
              </span>
              <span className="font-semibold">{summary.avgDurationMs} ms</span>
            </div>
            <div className="flex justify-between items-center pt-1 mt-1 border-t border-current/10">
              <span className="opacity-60 flex items-center gap-1">
                <Clock size={10} />
                Última
              </span>
              <span className="font-medium text-[11px]">{formatDate(summary.lastEntryAt)}</span>
            </div>
            <div className="flex gap-3 text-[11px] pt-1">
              <span className="text-emerald-700">✓ {summary.successes}</span>
              {summary.failures > 0 && <span className="text-rose-700">✕ {summary.failures}</span>}
              {summary.timeouts > 0 && (
                <span className="text-orange-700">⏱ {summary.timeouts}</span>
              )}
              {summary.blocked > 0 && (
                <span
                  className="text-slate-600"
                  title="Rechazos por guardia de versión; el cliente los reintenta y no cuentan como error"
                >
                  ⛔ {summary.blocked} bloq.
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
