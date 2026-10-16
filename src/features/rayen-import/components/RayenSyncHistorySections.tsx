import React from 'react';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import {
  presentRayenCoverage,
  presentRayenCoverageIssue,
  presentRayenLegacyCoverageGap,
} from './rayenSyncPresentation';
import { RayenSyncTechnicalMetricsPanel } from './RayenSyncTechnicalMetricsPanel';
import { RayenSyncStructuralReviewDetail } from './RayenSyncStructuralReviewDetail';
import { RayenSyncIssueActions } from './RayenSyncIssueActions';
import { rayenClinicalIssueTarget, rayenSyncTechnicalCode } from './rayenSyncIssueSupport';

const sourceLabel = (event: RayenSyncEvent): string | null => {
  const source = event.source;
  if (!source) return null;
  const version = source.extensionVersion ? `Ext. v${source.extensionVersion}` : 'Extensión';
  const ficha = source.fichaMedico === 'ready' ? 'Ficha ✓' : 'Ficha —';
  const camas = source.gestionCamas === 'ready' ? 'Camas ✓' : 'Camas —';
  return `${version} · ${ficha} · ${camas}`;
};

const TechnicalMetadata: React.FC<{ event: RayenSyncEvent }> = ({ event }) => {
  const source = sourceLabel(event);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs">
      {source && <span className="font-medium text-slate-400">{source}</span>}
      {event.policy && (
        <span className="font-medium text-slate-400">
          Política {event.policy.mode === 'auto' ? 'automática' : 'con revisión'} · rev.{' '}
          {event.policy.revision} · lote {event.policy.clinicalBatchMode ?? 'legacy'}
        </span>
      )}
      {event.reviewRequirement === 'day_bootstrap' && (
        <span className="font-medium text-slate-500">Revisión exigida por inicio del día</span>
      )}
      {event.coverage?.incremental && (
        <span
          className="font-medium tabular-nums text-slate-500"
          title="Resumen agregado; no contiene nombres, RUT ni valores clínicos"
        >
          Incremental: {event.coverage.incremental.newFacts} nuevos ·{' '}
          {event.coverage.incremental.duplicates} ya conocidos ·{' '}
          {event.coverage.incremental.corrections} corregidos ·{' '}
          {event.coverage.incremental.patientWrites} escrituras
        </span>
      )}
      {event.coverage?.incremental?.batch && (
        <span
          className="font-medium tabular-nums text-slate-500"
          title="Comparación agregada del lote transaccional; no contiene datos clínicos"
        >
          Lote {event.coverage.incremental.batch.mode}:{' '}
          {event.coverage.incremental.batch.parity === 'matched'
            ? 'paridad confirmada'
            : event.coverage.incremental.batch.parity === 'mismatch'
              ? 'paridad no coincide'
              : 'sin evidencia'}{' '}
          · {event.coverage.incremental.batch.clinicalTargets} clínicos ·{' '}
          {event.coverage.incremental.batch.checkpointOnlyTargets} sólo checkpoint
        </span>
      )}
    </div>
  );
};

export const RayenSyncClinicalSection: React.FC<{
  event: RayenSyncEvent;
  targetDate?: string | null;
}> = ({ event, targetDate }) => {
  const censusDate = event.sourceDate ?? targetDate;
  const coverage = presentRayenCoverage(
    event.coverage,
    event.status !== 'failed',
    event.status === 'applied'
  );
  return (
    <section aria-label="Datos clínicos" className="mt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={
            coverage.tone === 'success'
              ? 'text-xs text-slate-500'
              : coverage.tone === 'warning'
                ? 'text-sm font-semibold text-amber-700'
                : 'text-sm text-slate-500'
          }
        >
          Cobertura clínica: {coverage.label}
        </span>
      </div>
      <RayenSyncStructuralReviewDetail review={event.structuralReview} censusDate={censusDate} />
      {event.coverage &&
        (event.coverage.errors > 0 ||
          event.coverage.sourceErrors > 0 ||
          Boolean(event.coverage.issues?.length)) && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-sm leading-relaxed text-amber-900">
            <p className="font-bold">Qué quedó pendiente en la información clínica</p>
            {event.coverage.issues?.length ? (
              <ul className="mt-1 space-y-1">
                {event.coverage.issues.map(issue => {
                  const target = rayenClinicalIssueTarget(issue, censusDate);
                  return (
                    <li key={`${issue.bedId}-${issue.source}-${issue.reason}`} className="py-1">
                      <p>{presentRayenCoverageIssue(issue)}</p>
                      <RayenSyncIssueActions
                        code={rayenSyncTechnicalCode(issue.source, issue.reason)}
                        date={target?.date}
                        bedId={target?.bedId}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1">{presentRayenLegacyCoverageGap(event.coverage)}</p>
            )}
          </div>
        )}

      <details data-testid="rayen-sync-technical-report" className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
          Reporte técnico
        </summary>
        <TechnicalMetadata event={event} />
        <RayenSyncTechnicalMetricsPanel performance={event.performance} embedded />
        {!event.performance && (
          <p className="mt-2 text-slate-500">
            Esta ejecución no conserva tiempos ni contadores técnicos detallados.
          </p>
        )}
      </details>
    </section>
  );
};
