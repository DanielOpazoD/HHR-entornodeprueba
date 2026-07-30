import React from 'react';
import { AlertTriangle, CheckCircle2, Gauge, ShieldCheck } from 'lucide-react';
import type {
  RayenClinicalEnrichmentRolloutRecommendation,
  RayenClinicalEnrichmentRolloutSummary,
} from '@/types/functionsTelemetry';

interface Props {
  summary: RayenClinicalEnrichmentRolloutSummary;
}

const recommendationCopy: Record<
  RayenClinicalEnrichmentRolloutRecommendation,
  { label: string; tone: string; icon: React.ReactNode }
> = {
  insufficient_data: {
    label: 'Reunir más evidencia shadow',
    tone: 'bg-slate-50 border-slate-200 text-slate-700',
    icon: <Gauge size={18} />,
  },
  ready_for_enforced: {
    label: 'Listo para activar el lote',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: <CheckCircle2 size={18} />,
  },
  monitor_enforced: {
    label: 'Lote activo en monitoreo',
    tone: 'bg-sky-50 border-sky-200 text-sky-700',
    icon: <ShieldCheck size={18} />,
  },
  investigate: {
    label: 'Investigar antes de activar',
    tone: 'bg-amber-50 border-amber-200 text-amber-700',
    icon: <AlertTriangle size={18} />,
  },
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-current/10 bg-white/70 px-3 py-2">
    <div className="text-[11px] uppercase font-semibold opacity-70">{label}</div>
    <div className="text-lg font-bold leading-tight">{value}</div>
  </div>
);

export const RayenClinicalEnrichmentRolloutCard: React.FC<Props> = ({ summary }) => {
  const recommendation = recommendationCopy[summary.recommendation];

  return (
    <section className={`rounded-2xl shadow-sm border p-4 mb-6 ${recommendation.tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge size={18} />
            <h2 className="text-sm font-bold uppercase tracking-wide">
              Lote clínico transaccional
            </h2>
          </div>
          <p className="mt-1 text-xs opacity-75">
            Gate operativo: mínimo 4 ejecuciones shadow coincidentes, 8 horas de evidencia y cero
            señales bloqueantes.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-lg bg-white/75 px-3 py-1.5 text-xs font-bold">
          {recommendation.icon}
          {recommendation.label}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-sm">
        <Metric label="Shadow" value={summary.shadowRuns} />
        <Metric label="Paridad OK" value={summary.matchedShadowRuns} />
        <Metric label="Mismatch" value={summary.mismatchedShadowRuns} />
        <Metric label="Sin paridad" value={summary.unavailableShadowRuns} />
        <Metric label="Enforced" value={summary.enforcedWrites} />
        <Metric label="Fallas" value={summary.failureCount} />
        <Metric label="Bloqueos" value={summary.blockedCount} />
        <Metric label="Horas" value={summary.evidenceHours} />
      </div>
    </section>
  );
};
