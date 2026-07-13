import React from 'react';
import { History, RefreshCw } from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useRayenImport } from '../hooks/useRayenImport';
import { useRayenFillProgress } from '../hooks/useRayenFillStatus';
import { RayenImportPreviewModal } from './RayenImportPreviewModal';
import type { RayenSyncMeta } from '@/types/domain/dailyRecord';

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

  return (
    <div className="flex flex-col items-stretch gap-1">
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
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-70"
      >
        <RefreshCw size={15} strokeWidth={2.5} className={working ? 'animate-spin' : ''} />
        {working ? 'Sincronizando…' : 'Sincronizar Eloísa'}
        {mode === 'auto' && (
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            Auto
          </span>
        )}
      </button>

      <span
        className="inline-flex items-center justify-center gap-1 text-[10px] leading-tight text-slate-500"
        data-testid="rayen-last-sync"
        title={
          lastSync ? `Última sincronización con Eloísa · ${record?.rayenSync?.by ?? ''}` : undefined
        }
      >
        <History size={10} aria-hidden />
        {lastSync ? (
          <>
            <span className="tabular-nums">{lastSync}</span>
            <span className="text-slate-300">·</span>
            <span className="max-w-[140px] truncate font-medium text-slate-600">
              {record?.rayenSync?.by}
            </span>
          </>
        ) : (
          <span className="italic text-slate-400">Sin sincronización registrada</span>
        )}
      </span>

      <RayenImportPreviewModal
        isOpen={isPreviewOpen}
        diff={diff}
        isBusy={isBusy}
        error={error}
        onConfirm={confirm}
        onCancel={cancel}
      />

      {fillNote && (
        <span
          className={
            fill.running
              ? 'text-center text-xs text-teal-700 animate-pulse motion-reduce:animate-none'
              : fill.errors > 0
                ? 'text-center text-xs text-amber-700'
                : 'text-center text-xs text-emerald-700'
          }
          data-testid="rayen-fill-status"
        >
          {fillNote}
        </span>
      )}

      {error && !isPreviewOpen && (
        <span
          className="max-w-[220px] text-center text-xs text-red-600"
          data-testid="rayen-import-error"
        >
          {error}
        </span>
      )}

      {result && !isPreviewOpen && !error && (
        <span
          className="max-w-[220px] text-center text-xs text-gray-500"
          data-testid="rayen-import-result"
        >
          Sincronizado: {result.applied.admissions} ingresos, {result.applied.updates} act.,{' '}
          {result.applied.moves} mov., {result.applied.discharges} egresos
          {result.skipped.length > 0 && ` · ${result.skipped.length} omitidos`}
        </span>
      )}
    </div>
  );
};
