import React from 'react';
import type { RayenSyncPerformance } from '@/types/domain/rayenSync';

const STAGE_LABELS: Array<[keyof RayenSyncPerformance['stagesMs'], string]> = [
  ['preflight', 'Preflight'],
  ['dualCapture', 'Captura dual'],
  ['reconciliation', 'Reconciliación total'],
  ['historicalEvidence', 'Evidencia histórica incluida'],
  ['clinicalReads', 'Lecturas clínicas'],
  ['writeQueueWait', 'Espera interna sumada'],
  ['persistence', 'Persistencia sumada'],
];

const formatDuration = (durationMs: number): string =>
  durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} s`;

const countLabel = (value: number, singular: string, plural: string): string =>
  `${value} ${value === 1 ? singular : plural}`;

export const RayenSyncTechnicalMetricsPanel: React.FC<{
  performance?: RayenSyncPerformance;
}> = ({ performance }) => {
  if (!performance) return null;
  const stages = STAGE_LABELS.flatMap(([key, label]) => {
    const value = performance.stagesMs[key];
    return value == null ? [] : [{ key, label, value }];
  });
  const { counters } = performance;
  const physicianQuality = performance.sourceQuality?.treatingPhysicians;
  const coordination = performance.coordination;

  return (
    <details
      data-testid="rayen-sync-technical-metrics"
      className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700"
    >
      <summary className="cursor-pointer font-bold text-slate-700">Detalle técnico</summary>
      <div className="mt-2 space-y-2" role="group" aria-label="Telemetría técnica agregada">
        {stages.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
            {stages.map(stage => (
              <div key={stage.key} className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">{stage.label}</dt>
                <dd className="font-semibold tabular-nums">{formatDuration(stage.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="font-medium tabular-nums text-slate-600">
          {countLabel(counters.requests, 'solicitud Eloísa', 'solicitudes Eloísa')} ·{' '}
          {countLabel(counters.cacheHits, 'acierto de caché', 'aciertos de caché')} ·{' '}
          {countLabel(counters.patches, 'parche', 'parches')} ·{' '}
          {countLabel(counters.retries, 'reintento', 'reintentos')} ·{' '}
          {countLabel(counters.timeouts, 'timeout', 'timeouts')}
        </p>
        {coordination && (
          <p className="tabular-nums text-slate-500">
            Contexto {coordination.target === 'historical' ? 'histórico' : 'actual'} ·{' '}
            {countLabel(
              coordination.structuralReplans,
              'replanteamiento estructural',
              'replanteamientos estructurales'
            )}{' '}
            · {coordination.confirmedEpisodes} episodios confirmados ·{' '}
            {coordination.omittedEpisodes} omitidos ·{' '}
            {countLabel(
              coordination.clinicalRetries,
              'reintento clínico',
              'reintentos clínicos'
            )}
          </p>
        )}
        {physicianQuality && (
          <p className="tabular-nums text-slate-500">
            Médicos tratantes: {physicianQuality.assignedEncounters} asignados ·{' '}
            {physicianQuality.sourceResolvedNames} nombres desde Eloísa ·{' '}
            {physicianQuality.plannedResolvedNames} disponibles para sincronizar ·{' '}
            {physicianQuality.catalogEntries} en catálogo · {physicianQuality.encounters} encuentros
          </p>
        )}
        {(performance.stagesMs.writeQueueWait != null ||
          performance.stagesMs.persistence != null) && (
          <p className="text-[10px] text-slate-400">
            Las esperas y persistencias se suman entre pacientes; pueden superar la duración total
            de la sincronización.
          </p>
        )}
        <p className="text-[10px] text-slate-400">
          Sólo agregados técnicos; no contiene pacientes, camas, episodios, nombres profesionales ni
          valores clínicos.
        </p>
      </div>
    </details>
  );
};
