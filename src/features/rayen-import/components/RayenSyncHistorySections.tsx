import React from 'react';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import {
  presentRayenCoverage,
  presentRayenCoverageIssue,
  presentRayenLegacyCoverageGap,
} from './rayenSyncPresentation';
import { StaffingBoundaryExclusions } from './StaffingBoundaryExclusions';
import { RayenSyncTechnicalMetricsPanel } from './RayenSyncTechnicalMetricsPanel';
import { RayenSyncStructuralReviewDetail } from './RayenSyncStructuralReviewDetail';

const sourceLabel = (event: RayenSyncEvent): string | null => {
  const source = event.source;
  if (!source) return null;
  const version = source.extensionVersion ? `Ext. v${source.extensionVersion}` : 'Extensión';
  const ficha = source.fichaMedico === 'ready' ? 'Ficha ✓' : 'Ficha —';
  const camas = source.gestionCamas === 'ready' ? 'Camas ✓' : 'Camas —';
  return `${version} · ${ficha} · ${camas}`;
};

const STAFFING_SECTION_LABELS = {
  nurse_day: 'Enfermería · turno día',
  nurse_night: 'Enfermería · turno noche',
  tens_day: 'TENS · turno largo',
  tens_night: 'TENS · turno noche',
} as const;

const TechnicalMetadata: React.FC<{ event: RayenSyncEvent }> = ({ event }) => {
  const source = sourceLabel(event);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px]">
      {source && <span className="font-medium text-slate-400">{source}</span>}
      {event.policy && (
        <span className="font-medium text-slate-400">
          Política {event.policy.mode === 'auto' ? 'automática' : 'con revisión'} · rev.{' '}
          {event.policy.revision} · lote {event.policy.clinicalBatchMode ?? 'legacy'}
        </span>
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

export const RayenSyncClinicalSection: React.FC<{ event: RayenSyncEvent }> = ({ event }) => {
  const coverage = presentRayenCoverage(
    event.coverage,
    event.status !== 'failed',
    event.status === 'applied'
  );
  return (
    <section aria-label="Datos clínicos" className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-800">Datos clínicos</h4>
        <span
          className={
            coverage.tone === 'success'
              ? 'text-xs font-semibold text-emerald-700'
              : coverage.tone === 'warning'
                ? 'text-xs font-semibold text-amber-700'
                : 'text-xs text-slate-500'
          }
        >
          Cobertura clínica: {coverage.label}
        </span>
      </div>
      <RayenSyncStructuralReviewDetail review={event.structuralReview} />
      {event.coverage &&
        (event.coverage.errors > 0 ||
          event.coverage.sourceErrors > 0 ||
          Boolean(event.coverage.issues?.length)) && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
            <p className="font-bold">Qué quedó pendiente en la información clínica</p>
            {event.coverage.issues?.length ? (
              <ul className="mt-1 space-y-1">
                {event.coverage.issues.map(issue => (
                  <li key={`${issue.bedId}-${issue.source}-${issue.reason}`}>
                    {presentRayenCoverageIssue(issue)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">{presentRayenLegacyCoverageGap(event.coverage)}</p>
            )}
          </div>
        )}

      <details
        data-testid="rayen-sync-technical-report"
        className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-700"
      >
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

export const RayenSyncStaffingSection: React.FC<{ event: RayenSyncEvent }> = ({ event }) => {
  const staffingNeedsReview = Boolean(event.staffingObservation?.ambiguousSections.length);
  return (
    <section aria-label="Enfermería y TENS" className="mt-3 border-t border-slate-100 pt-3">
      <h4 className="text-xs font-bold text-slate-800">Enfermería y TENS</h4>
      {event.staffingObservation && (
        <details
          data-testid="rayen-staffing-observation"
          className="mt-1 rounded-md text-[11px] text-slate-600"
        >
          <summary className="cursor-pointer rounded-md py-1.5 font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
            <span className={staffingNeedsReview ? 'text-amber-700' : 'text-slate-600'}>
              {staffingNeedsReview ? 'Requiere revisión' : 'Actividad de relevo'}
            </span>
            <span className="ml-2 font-normal text-slate-500">
              Ver detalle · {event.staffingObservation.ignoredBoundaryRecords} registros
            </span>
          </summary>
          {staffingNeedsReview && (
            <p className="mt-1">
              Pendiente de revisión:{' '}
              {event.staffingObservation.ambiguousSections
                .map(section => STAFFING_SECTION_LABELS[section])
                .join(', ')}
              .
            </p>
          )}
          {event.staffingObservation.ignoredBoundaryRecords > 0 && (
            <StaffingBoundaryExclusions
              total={event.staffingObservation.ignoredBoundaryRecords}
              evidence={event.staffingObservation.ignoredBoundaryEvidence ?? []}
              embedded
            />
          )}
        </details>
      )}

      {!event.staffingObservation && (
        <p className="mt-1 text-xs text-slate-500">
          Sin diagnóstico de dotación registrado en esta ejecución.
        </p>
      )}
    </section>
  );
};
