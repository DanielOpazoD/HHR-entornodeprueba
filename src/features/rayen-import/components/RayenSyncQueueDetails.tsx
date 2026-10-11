import { CloudUpload } from 'lucide-react';
import React from 'react';
import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import { retryQuarantinedSyncTask } from '@/services/storage/sync';
import { isPolicyBlockedCudyrArchive } from '@/services/storage/sync/cudyrPolicyBlockedRecovery';
import { listQuarantinedOperations } from './syncQueueStatusPresentation';

/** On-demand detail inside the existing Eloísa panel; never another census overlay. */
export const RayenSyncQueueDetails: React.FC<{
  stats: SyncQueueStats;
  operations: SyncQueueOperation[];
  refresh: () => Promise<void>;
  working: boolean;
}> = ({ stats, operations, refresh, working }) => {
  const [busy, setBusy] = React.useState(false);
  const [actionFailed, setActionFailed] = React.useState(false);
  const policyBlocked = operations.some(isPolicyBlockedCudyrArchive);
  const blocked = listQuarantinedOperations(
    operations.filter(op => !isPolicyBlockedCudyrArchive(op))
  );
  const total = stats.pending + stats.failed + stats.conflict + (stats.retrying ?? 0);
  const unavailable =
    stats.readState === 'unavailable' || stats.recentOperationsReadState === 'unavailable';
  if (!total && !unavailable) return null;
  const retry = async (id: number) => {
    setBusy(true);
    setActionFailed(false);
    try {
      setActionFailed(!(await retryQuarantinedSyncTask(id)));
      await refresh();
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="mt-3 border-t border-slate-100 pt-2 text-[11px]"
      data-testid="rayen-local-sync-details"
    >
      <summary className="cursor-pointer font-semibold text-slate-600">
        Guardado local · {unavailable ? 'por comprobar' : `${total} por enviar`}
      </summary>
      {unavailable && <p className="mt-1 text-amber-700">No se pudo leer la cola local.</p>}
      {policyBlocked && (
        <p className="mt-1 text-slate-500">
          CUDYR · autorización anterior. Se recupera al sincronizar.
        </p>
      )}
      {stats.pending > 0 && <p className="mt-1 text-slate-500">{stats.pending} en cola.</p>}
      {stats.retrying > 0 && <p className="mt-1 text-slate-500">{stats.retrying} reintentando.</p>}
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {blocked.map(operation => (
          <li key={operation.id} className="flex items-center justify-between gap-2">
            <span>
              {operation.targetLabel}
              <span className="block text-[10px] text-slate-500">{operation.categoryLabel}</span>
            </span>

            <button
              type="button"
              onClick={() => void retry(operation.id)}
              disabled={working || busy}
              className="text-teal-700 disabled:opacity-50"
            >
              Reintentar
            </button>
          </li>
        ))}
      </ul>
      {operations.filter(op => op.status === 'FAILED' || op.status === 'CONFLICT').length <
        stats.failed + stats.conflict && (
        <p className="mt-1 text-slate-400">Mostrando los últimos envíos.</p>
      )}
      {actionFailed && (
        <p className="mt-1 text-amber-700" role="status">
          El envío sigue pendiente.
        </p>
      )}
    </details>
  );
};

export const RayenSyncStatusLine: React.FC<{
  pending: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}> = ({ pending, onOpen, children }) => (
  <div className="flex min-w-0 items-center gap-1">
    <div className="min-w-0 flex-1">{children}</div>
    {pending && (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Guardado pendiente · Ver detalle"
        title="Guardado pendiente · Ver detalle"
        className="shrink-0 rounded text-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <CloudUpload size={13} aria-hidden="true" />
      </button>
    )}
  </div>
);
