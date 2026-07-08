import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type {
  DailyRecordAuthorityRolloutRecommendation,
  DailyRecordAuthorityRolloutSummary,
} from '@/types/functionsTelemetry';

interface Props {
  summary: DailyRecordAuthorityRolloutSummary;
}

const recommendationCopy: Record<
  DailyRecordAuthorityRolloutRecommendation,
  { label: string; tone: string; icon: React.ReactNode }
> = {
  insufficient_data: {
    label: 'Sin evidencia suficiente',
    tone: 'bg-slate-50 border-slate-200 text-slate-700',
    icon: <ShieldCheck size={18} />,
  },
  ready_for_enforced: {
    label: 'Listo para enforced',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: <CheckCircle2 size={18} />,
  },
  monitor_enforced: {
    label: 'Enforced en monitoreo',
    tone: 'bg-sky-50 border-sky-200 text-sky-700',
    icon: <ShieldCheck size={18} />,
  },
  investigate: {
    label: 'Investigar antes de activar',
    tone: 'bg-amber-50 border-amber-200 text-amber-700',
    icon: <AlertTriangle size={18} />,
  },
};

const formatDate = (iso?: string) => {
  if (!iso) return '-';
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

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-current/10 bg-white/70 px-3 py-2">
    <div className="text-[11px] uppercase font-semibold opacity-70">{label}</div>
    <div className="text-lg font-bold leading-tight">{value}</div>
  </div>
);

export const DailyRecordAuthorityRolloutCard: React.FC<Props> = ({ summary }) => {
  const recommendation = recommendationCopy[summary.recommendation];

  return (
    <section className={`rounded-2xl shadow-sm border p-4 mb-6 ${recommendation.tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} />
            <h2 className="text-sm font-bold uppercase tracking-wide">Autoridad censo diario</h2>
          </div>
          <p className="mt-1 text-xs opacity-75">
            Resumen operativo de shadow/enforced para escrituras del censo diario.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-lg bg-white/75 px-3 py-1.5 text-xs font-bold">
          {recommendation.icon}
          {recommendation.label}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-sm">
        <Metric label="Total" value={summary.total} />
        <Metric label="Shadow" value={summary.shadowRuns} />
        <Metric label="Enforced" value={summary.enforcedWrites} />
        <Metric label="Éxitos" value={summary.successCount} />
        <Metric label="Fallas" value={summary.failureCount} />
        <Metric label="Bloqueos" value={summary.blockedCount} />
        <Metric label="Permisos" value={summary.permissionDeniedCount} />
        <Metric label="Fallback degenerado" value={summary.degenerateFallbackEpisodeKeys} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-80">
        <span>
          Fallback episodeKey:{' '}
          <strong className="font-semibold">{summary.fallbackEpisodeKeys}</strong>
        </span>
        <span>
          Última señal: <strong className="font-semibold">{formatDate(summary.lastEntryAt)}</strong>
        </span>
      </div>
    </section>
  );
};
