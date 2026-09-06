import React from 'react';
import { Check, Circle, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';
import type { RayenSyncStage } from '../hooks/rayenSyncExecutionState';
import type { RayenFillProgress } from '../hooks/useRayenFillStatus';
import { buildRayenSyncBarViewModel, type RayenSyncBarTone } from './rayenSyncBarViewModel';

interface RayenImportFlowStatusProps {
  diff: CensusImportDiff | null;
  fill: RayenFillProgress;
  error: string | null;
  hasPersistedSync: boolean;
  persistedSync?: Pick<RayenSyncMeta, 'status' | 'coverage' | 'staffingObservation'> | null;
  executionStage?: RayenSyncStage | null;
  targetDate?: string | null;
  compactFallback?: string;
}

const toneClass: Record<RayenSyncBarTone, string> = {
  neutral: 'text-slate-600',
  progress: 'text-teal-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
};

export const RayenImportFlowStatus: React.FC<RayenImportFlowStatusProps> = props => {
  const viewModel = buildRayenSyncBarViewModel(props);
  const progressPercent =
    viewModel.progress?.kind === 'determinate'
      ? Math.round((viewModel.progress.done / viewModel.progress.total) * 100)
      : null;
  const StatusIcon =
    viewModel.tone === 'progress'
      ? LoaderCircle
      : viewModel.tone === 'success'
        ? Check
        : viewModel.tone === 'warning'
          ? TriangleAlert
          : Circle;

  return (
    <section
      className={
        props.compactFallback !== undefined ? 'relative h-4 min-w-0' : 'relative min-w-0 px-0.5'
      }
      aria-label="Estado de sincronización con Eloísa"
      aria-busy={viewModel.ariaBusy}
      data-phase={viewModel.phase}
      data-testid="rayen-sync-pulse"
      title={props.compactFallback}
    >
      {props.compactFallback !== undefined && (
        <p className={viewModel.visuallyHidden ? 'truncate' : 'sr-only'}>{props.compactFallback}</p>
      )}
      <div className={viewModel.visuallyHidden ? 'sr-only' : 'flex min-w-0 items-center gap-2'}>
        <StatusIcon
          size={props.compactFallback !== undefined ? 11 : 15}
          className={
            viewModel.tone === 'progress'
              ? 'shrink-0 animate-spin text-teal-600 motion-reduce:animate-none'
              : `shrink-0 ${toneClass[viewModel.tone]}`
          }
          aria-hidden="true"
        />
        <p
          className={`min-w-0 font-semibold leading-snug ${props.compactFallback !== undefined ? 'truncate text-[10px]' : 'text-xs'} ${toneClass[viewModel.tone]}`}
          title={viewModel.label}
          role="status"
          aria-live="polite"
        >
          {viewModel.label}
        </p>
        {viewModel.detail && (
          <details
            className="group ml-auto shrink-0 text-[11px] text-amber-800"
            data-testid="rayen-import-error"
          >
            <summary
              className={`cursor-pointer rounded px-1.5 ${props.compactFallback !== undefined ? 'py-0' : 'py-1'} font-semibold hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600`}
            >
              Ver detalle
            </summary>
            <p className="absolute left-0 top-[calc(100%+0.45rem)] z-30 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-[11px] font-medium leading-relaxed text-amber-900 shadow-lg">
              {viewModel.detail}
            </p>
          </details>
        )}
      </div>

      {viewModel.progress && (
        <div
          className={`${props.compactFallback !== undefined ? 'absolute -bottom-0.5 left-0 right-0 h-0.5' : 'relative mt-1.5 h-[3px]'} min-w-0 overflow-hidden rounded-full bg-slate-200`}
          role="progressbar"
          aria-label="Progreso de sincronización con Eloísa"
          aria-valuemin={viewModel.progress.kind === 'determinate' ? 0 : undefined}
          aria-valuemax={
            viewModel.progress.kind === 'determinate' ? viewModel.progress.total : undefined
          }
          aria-valuenow={
            viewModel.progress.kind === 'determinate' ? viewModel.progress.done : undefined
          }
          aria-valuetext={viewModel.label}
        >
          {viewModel.progress.kind === 'determinate' ? (
            <span
              className="block h-full rounded-full bg-teal-600 transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${progressPercent}%` }}
              aria-hidden="true"
            />
          ) : (
            <span
              className="absolute inset-0 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-teal-500 motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </section>
  );
};
