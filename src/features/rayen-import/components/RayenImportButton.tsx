import React from 'react';
import { CheckCircle2, Clock3, DatabaseZap, RefreshCw, UserRound } from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useRayenImport } from '../hooks/useRayenImport';
import { useRayenFillProgress } from '../hooks/useRayenFillStatus';
import { RayenImportPreviewModal } from './RayenImportPreviewModal';
import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';

/**
 * "Sincronizar Eloísa" module for the census toolbar: the sync trigger plus its provenance line —
 * when the last sync of this day ran and who ran it (`record.rayenSync`, stamped on every apply).
 *
 * Clicking asks the extension for a fresh snapshot; when it arrives, the hook either opens the
 * preview (default) or applies automatically (experimental mode). While the whole flow runs
 * (snapshot → plan → background device/scale/CUDYR fill) the button shows a spinning
 * "Sincronizando…" state so it's clear the sync is actually in progress.
 */

/** Last-sync instant formatted in island time (Pacific/Easter), e.g. "12-07-2026 · 14:32 h". */
const formatLastSync = (meta: RayenSyncMeta): string | null => {
  const when = new Date(meta.at);
  if (Number.isNaN(when.getTime())) return null;
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'Pacific/Easter',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const get = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} · ${get('hour')}:${get('minute')} h`;
};

export const RayenImportButton: React.FC = () => {
  const {
    mode,
    diff,
    isPreviewOpen,
    isBusy,
    isSyncing,
    result,
    error,
    triggerImport,
    confirm,
    cancel,
  } = useRayenImport();

  const { record } = useDailyRecordData();
  const fill = useRayenFillProgress();
  const working = isSyncing || isBusy;

  const lastSync = record?.rayenSync ? formatLastSync(record.rayenSync) : null;

  // Visible, verifiable fill status: live progress while running, then a completion summary with
  // the per-patient error count — so the user can tell whether devices/scores actually synced.
  const fillNote = fill.running
    ? `Datos clínicos ${fill.done}/${fill.total}…`
    : fill.lastCompletedAt
      ? fill.errors > 0
        ? `Datos clínicos: ${Math.max(fill.total - fill.errors, 0)}/${fill.total} · ${fill.errors} con error`
        : `Datos clínicos: ${fill.total}/${fill.total} ✓`
      : null;

  const sourceState = working
    ? 'Actualizando fuente'
    : lastSync
      ? 'Fuente actualizada'
      : 'Pendiente de sincronizar';
  const responsibleState = lastSync ? (record?.rayenSync?.by ?? 'Sin identificar') : 'Sin registro';
  const coverageState = fillNote
    ? fillNote.replace('Datos clínicos: ', '').replace('Datos clínicos ', '')
    : lastSync
      ? 'No calculada'
      : 'Sin sincronización';

  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      data-testid="rayen-operations-bar"
    >
      <div className="grid min-h-14 grid-cols-1 items-center gap-2 px-3 py-2 md:grid-cols-[minmax(205px,0.9fr)_minmax(280px,1.55fr)_auto]">
        <div className="flex min-w-[205px] items-center gap-2.5">
          <span
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border ${
              working
                ? 'border-teal-200 bg-teal-100 text-teal-700'
                : lastSync
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
            aria-hidden="true"
          >
            <DatabaseZap size={18} strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">
              Fuente clínica externa
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold leading-tight text-slate-800">Eloísa</p>
              <span
                className={`size-1.5 rounded-full ${
                  working
                    ? 'animate-pulse bg-teal-500'
                    : lastSync
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium text-slate-500">{sourceState}</span>
            </div>
          </div>
        </div>

        <div
          className="grid min-w-0 grid-cols-1 gap-x-0 gap-y-1 border-slate-200 md:border-l md:pl-3 lg:grid-cols-[minmax(155px,1fr)_minmax(135px,0.9fr)_minmax(125px,0.8fr)] lg:divide-x lg:divide-slate-100"
          data-testid="rayen-last-sync"
          title={
            lastSync
              ? `Última sincronización con Eloísa · ${record?.rayenSync?.by ?? ''}`
              : undefined
          }
        >
          <div className="min-w-[155px] lg:pr-4">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
              <Clock3 size={11} aria-hidden="true" />
              Última sincronización
            </p>
            <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
              {lastSync ?? 'Sin sincronización registrada'}
            </p>
          </div>

          <div className="min-w-0 lg:px-4">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
              <UserRound size={11} aria-hidden="true" />
              Responsable
            </p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
              {responsibleState}
            </p>
          </div>

          <div className="min-w-0 lg:pl-4">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
              <CheckCircle2 size={11} aria-hidden="true" />
              Cobertura clínica
            </p>
            <p
              className={`mt-0.5 truncate text-[11px] font-semibold ${
                fill.running
                  ? 'animate-pulse text-teal-700 motion-reduce:animate-none'
                  : fillNote
                    ? fill.errors > 0
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                    : 'text-slate-400'
              }`}
              data-testid="rayen-fill-status"
            >
              {coverageState}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={triggerImport}
            disabled={working}
            aria-busy={working}
            title={
              mode === 'auto'
                ? 'Sincronizar el censo con Eloísa (modo automático experimental)'
                : 'Sincronizar el censo con Eloísa (con revisión)'
            }
            data-module="rayen-import"
            data-testid="rayen-import-button"
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-colors hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-70"
          >
            <RefreshCw size={15} strokeWidth={2.5} className={working ? 'animate-spin' : ''} />
            {working ? 'Sincronizando…' : 'Sincronizar'}
            {mode === 'auto' && (
              <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                Auto
              </span>
            )}
          </button>
        </div>
      </div>

      <RayenImportPreviewModal
        isOpen={isPreviewOpen}
        diff={diff}
        isBusy={isBusy}
        error={error}
        onConfirm={confirm}
        onCancel={cancel}
      />

      {error && !isPreviewOpen && (
        <p
          className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"
          data-testid="rayen-import-error"
        >
          {error}
        </p>
      )}

      {result && !isPreviewOpen && !error && (
        <p
          className="border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-600"
          data-testid="rayen-import-result"
        >
          Sincronizado: {result.applied.admissions} ingresos, {result.applied.updates} act.,{' '}
          {result.applied.moves} mov., {result.applied.discharges} egresos
          {result.skipped.length > 0 && ` · ${result.skipped.length} omitidos`}
        </p>
      )}
    </div>
  );
};
