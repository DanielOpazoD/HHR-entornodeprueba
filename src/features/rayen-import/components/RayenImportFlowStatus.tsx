import React from 'react';
import { Check, Circle, LoaderCircle } from 'lucide-react';
import type { RayenFillProgress } from '../hooks/useRayenFillStatus';

interface RayenImportFlowStatusProps {
  isApplyingCensus: boolean;
  fill: RayenFillProgress;
  completed: boolean;
  hasUnresolvedConflicts?: boolean;
  hasSkippedItems?: boolean;
}

const scopeItems = ['Censo y demografía', 'Signos vitales', 'Dispositivos', 'Enfermería'];

const progressPercentage = (fill: RayenFillProgress, completed: boolean): number => {
  if (fill.outcome === 'rejected') return 0;
  if (completed) return 100;
  if (fill.outcome !== 'running' || fill.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((fill.done / fill.total) * 100)));
};

export const RayenImportFlowStatus: React.FC<RayenImportFlowStatusProps> = ({
  isApplyingCensus,
  fill,
  completed,
  hasUnresolvedConflicts = false,
  hasSkippedItems = false,
}) => {
  const percent = progressPercentage(fill, completed);
  const completedScope = completed && fill.outcome !== 'rejected';
  const active = isApplyingCensus || fill.outcome === 'running';
  const staffingNeedsDecision =
    fill.staffingOutcome === 'pending' || fill.staffingOutcome === 'ambiguous';
  const label = isApplyingCensus
    ? 'Actualizando censo y demografía'
    : fill.outcome === 'running'
      ? 'Revisando información clínica'
      : fill.outcome === 'rejected'
        ? 'La información clínica no pudo iniciar'
        : fill.staffingOutcome === 'applying'
          ? 'Actualizando enfermería'
          : completed
            ? fill.outcome === 'partial' || fill.errors > 0
              ? 'Sincronización completada con observaciones'
              : hasUnresolvedConflicts
                ? 'Sincronización completada con conflictos pendientes'
                : hasSkippedItems
                  ? 'Sincronización completada con elementos sin aplicar'
                  : staffingNeedsDecision
                    ? 'Información revisada · confirma enfermería'
                    : 'Sincronización completada'
            : 'Se revisará al confirmar';

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
        <span role="status" aria-live="polite">
          {label}
        </span>
        <span className="tabular-nums text-slate-500">{percent}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Progreso de sincronización con Eloísa"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% · ${label}`}
      >
        <div
          className="h-full rounded-full bg-teal-600 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Datos incluidos">
        {scopeItems.map((item, index) => {
          const nursing = index === scopeItems.length - 1;
          const running = nursing
            ? fill.staffingOutcome === 'applying'
            : active && (index === 0 ? isApplyingCensus : fill.outcome === 'running');
          const done = nursing
            ? completedScope && fill.staffingOutcome === 'resolved'
            : completedScope || (fill.outcome === 'running' && index === 0);
          const Icon = running ? LoaderCircle : done ? Check : Circle;
          return (
            <span
              key={item}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200"
            >
              <Icon
                size={12}
                className={
                  running
                    ? 'animate-spin text-teal-600 motion-reduce:animate-none'
                    : done
                      ? 'text-emerald-600'
                      : 'text-slate-300'
                }
                aria-hidden="true"
              />
              <span className="truncate">{item}</span>
            </span>
          );
        })}
      </div>
      {completed && (fill.outcome === 'partial' || fill.errors > 0) && (
        <details className="mt-2 text-xs text-amber-800">
          <summary className="cursor-pointer font-medium">Ver observaciones</summary>
          {fill.errors > 0 ? (
            <p className="mt-1 leading-relaxed">
              {fill.errors} paciente{fill.errors === 1 ? '' : 's'} requiere
              {fill.errors === 1 ? '' : 'n'} revisión. El detalle permanece disponible en el
              historial de sincronización.
            </p>
          ) : (
            <p className="mt-1 leading-relaxed">
              Parte de la información clínica no pudo revisarse. El detalle permanece disponible en
              el historial de sincronización.
            </p>
          )}
        </details>
      )}
      {completed && hasUnresolvedConflicts && (
        <details className="mt-2 text-xs text-amber-800" open>
          <summary className="cursor-pointer font-medium">Ver conflictos pendientes</summary>
          <p className="mt-1 leading-relaxed">
            Los conflictos del censo no se aplicaron y permanecen disponibles para revisión.
          </p>
        </details>
      )}
      {completed && hasSkippedItems && (
        <p className="mt-2 text-xs leading-relaxed text-amber-800">
          Algunos cambios se conservaron sin aplicar. Puedes revisarlos en el detalle de esta
          sincronización.
        </p>
      )}
      {completed && staffingNeedsDecision && (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Revisa la propuesta de enfermería antes de cerrar esta sincronización.
        </p>
      )}
      {fill.outcome === 'rejected' && (
        <details className="mt-2 text-xs text-amber-800" open>
          <summary className="cursor-pointer font-medium">Ver observación</summary>
          <p className="mt-1 leading-relaxed">
            Ya había otra sincronización clínica en curso. Espera a que termine y vuelve a
            intentarlo.
          </p>
        </details>
      )}
    </section>
  );
};
