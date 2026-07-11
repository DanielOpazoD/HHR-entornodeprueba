import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useRayenImport } from '../hooks/useRayenImport';
import { useRayenFillProgress } from '../hooks/useRayenFillStatus';
import { RayenImportPreviewModal } from './RayenImportPreviewModal';

/**
 * "Importar desde Rayen" trigger for the census toolbar.
 *
 * Clicking asks the extension for a fresh snapshot; when it arrives, the hook either
 * opens the preview (default) or applies automatically (experimental mode). While the whole
 * flow runs (snapshot → plan → background device/scale/CUDYR fill) the button shows a spinning
 * "Sincronizando…" state so it's clear the sync is actually in progress. Renders the preview modal
 * and a short result note.
 */
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

  const fill = useRayenFillProgress();
  const working = isSyncing || isBusy;

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
    <>
      <button
        type="button"
        onClick={triggerImport}
        disabled={working}
        aria-busy={working}
        title={
          mode === 'auto'
            ? 'Importar desde Rayen (modo automático experimental)'
            : 'Importar censo desde Rayen (con revisión)'
        }
        data-module="rayen-import"
        data-testid="rayen-import-button"
        className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-progress disabled:opacity-70"
      >
        <RefreshCw size={16} className={working ? 'animate-spin' : ''} />
        {working ? 'Sincronizando…' : 'Importar desde Rayen'}
        {mode === 'auto' && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            Auto
          </span>
        )}
      </button>

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
              ? 'ml-2 text-xs text-teal-700 animate-pulse'
              : fill.errors > 0
                ? 'ml-2 text-xs text-amber-700'
                : 'ml-2 text-xs text-emerald-700'
          }
          data-testid="rayen-fill-status"
        >
          {fillNote}
        </span>
      )}

      {error && !isPreviewOpen && (
        <span className="ml-2 text-xs text-red-600" data-testid="rayen-import-error">
          {error}
        </span>
      )}

      {result && !isPreviewOpen && !error && (
        <span className="ml-2 text-xs text-gray-500" data-testid="rayen-import-result">
          Importado: {result.applied.admissions} ingresos, {result.applied.updates} act.,{' '}
          {result.applied.moves} mov., {result.applied.discharges} egresos
          {result.skipped.length > 0 && ` · ${result.skipped.length} omitidos`}
        </span>
      )}
    </>
  );
};
