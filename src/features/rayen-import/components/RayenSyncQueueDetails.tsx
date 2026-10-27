import React from 'react';
import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import { discardQuarantinedSyncTask, retryQuarantinedSyncTask } from '@/services/storage/sync';
import { isPolicyBlockedCudyrArchive } from '@/services/storage/sync/cudyrPolicyBlockedRecovery';
import { listQuarantinedOperations, targetLabelFromKey } from './localSyncPresentation';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

const DailyRecordTaskRecovery = lazyWithRetry(() => import('./DailyRecordTaskRecovery'));

/** On-demand detail inside the existing Eloísa panel; never another census overlay. */
export const RayenSyncQueueDetails: React.FC<{
  stats: SyncQueueStats;
  operations: SyncQueueOperation[];
  refresh: () => Promise<void>;
  working: boolean;
}> = ({ stats, operations, refresh, working }) => {
  const [busy, setBusy] = React.useState(false);
  const [actionFailed, setActionFailed] = React.useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = React.useState<number | null>(null);
  const [reviewingCensus, setReviewingCensus] = React.useState<number | null>(null);
  const [showBackups, setShowBackups] = React.useState(false);
  const policyBlocked = operations.some(isPolicyBlockedCudyrArchive);
  const blocked = listQuarantinedOperations(
    operations.filter(op => !isPolicyBlockedCudyrArchive(op))
  );
  const total = stats.pending + stats.failed + stats.conflict + (stats.retrying ?? 0);
  const unavailable =
    stats.readState === 'unavailable' || stats.recentOperationsReadState === 'unavailable';
  const run = async (id: number, action: (taskId: number) => Promise<boolean>) => {
    setBusy(true);
    setActionFailed(false);
    setConfirmingDiscard(null);
    try {
      setActionFailed(!(await action(id)));
      await refresh();
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {(total > 0 || unavailable) && (
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
          {stats.retrying > 0 && (
            <p className="mt-1 text-slate-500">{stats.retrying} reintentando.</p>
          )}
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {operations
              .filter(op => op.status === 'PENDING' || op.status === 'PROCESSING')
              .map(op => (
                <li key={op.id} className="text-slate-500">
                  {targetLabelFromKey(op.key, op.type)} ·{' '}
                  {op.status === 'PROCESSING' ? 'Enviando' : 'Pendiente de confirmación'}
                </li>
              ))}
            {blocked.map(operation => (
              <li key={operation.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1">
                  {operation.targetLabel}
                  <span className="block text-[10px] text-slate-500">
                    {operation.categoryLabel}
                  </span>
                  {operation.recovery === 'review_base' && (
                    <span className="block text-[10px] text-amber-700">
                      Los cambios siguen guardados en este equipo. Solicita su revisión antes de
                      reenviarlos.
                    </span>
                  )}
                  {operation.recovery === 'review_authorization' && (
                    <span className="block text-[10px] text-amber-700">
                      {operation.retryGuidance}
                    </span>
                  )}
                  {(operation.code || operation.detail) && (
                    <details className="text-[10px] text-slate-400">
                      <summary>Detalle técnico</summary>
                      {operation.code && <span>{operation.code}</span>}
                      {operation.detail && <p>{operation.detail}</p>}
                    </details>
                  )}
                </span>

                <span className="flex flex-col items-end gap-1">
                  {operation.canRetire && (
                    <button
                      type="button"
                      onClick={() => setReviewingCensus(operation.id)}
                      disabled={working || busy}
                      className="text-rose-700 disabled:opacity-50"
                    >
                      Descartar envío
                    </button>
                  )}
                  {operation.recovery === 'review_base' ? null : operation.recovery ===
                    'review_authorization' ? (
                    <details className="max-w-32 text-right">
                      <summary className="cursor-pointer text-teal-700">Revisar reintento</summary>
                      <span className="block text-[10px] text-slate-500">
                        Reintenta solo si resolviste el bloqueo.
                      </span>
                      <button
                        type="button"
                        onClick={() => void run(operation.id, retryQuarantinedSyncTask)}
                        disabled={working || busy}
                        className="text-teal-700 disabled:opacity-50"
                      >
                        Ya revisé, reintentar
                      </button>
                    </details>
                  ) : operation.recovery === 'retry' ? (
                    <button
                      type="button"
                      onClick={() => void run(operation.id, retryQuarantinedSyncTask)}
                      disabled={working || busy}
                      className="text-teal-700 disabled:opacity-50"
                    >
                      Reintentar
                    </button>
                  ) : confirmingDiscard === operation.id ? (
                    <span className="text-right">
                      {operation.recovery === 'discard_note'
                        ? 'Revisa antes su borrador en Entrega médica.'
                        : 'Estos cambios no se enviarán.'}{' '}
                      <button
                        type="button"
                        onClick={() => void run(operation.id, discardQuarantinedSyncTask)}
                        disabled={working || busy}
                        className="text-rose-700 disabled:opacity-50"
                      >
                        Sí, descartar envío
                      </button>{' '}
                      <button type="button" onClick={() => setConfirmingDiscard(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDiscard(operation.id)}
                      disabled={working || busy}
                      className="text-rose-700 disabled:opacity-50"
                    >
                      Descartar
                    </button>
                  )}
                </span>
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
      )}
      {reviewingCensus !== null && (
        <React.Suspense fallback={<p role="status">Leyendo el envío…</p>}>
          <DailyRecordTaskRecovery
            key={reviewingCensus}
            kind="review"
            taskId={reviewingCensus}
            onClose={() => setReviewingCensus(null)}
            onRetired={async () => {
              await refresh();
              setReviewingCensus(null);
              setShowBackups(true);
            }}
          />
        </React.Suspense>
      )}
      <details
        className="mt-2 text-[11px]"
        onToggle={event => setShowBackups(event.currentTarget.open)}
        open={showBackups}
      >
        <summary className="cursor-pointer text-slate-500">Envíos descartados</summary>
        {showBackups && (
          <React.Suspense fallback={<p role="status">Leyendo las copias locales…</p>}>
            <DailyRecordTaskRecovery kind="backups" />
          </React.Suspense>
        )}
      </details>
    </>
  );
};
