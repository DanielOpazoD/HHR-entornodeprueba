import React from 'react';
import { CloudUpload, RefreshCw, Trash2 } from 'lucide-react';
import { useSyncQueueMonitor } from '@/hooks/useSyncQueueMonitor';
import { discardQuarantinedSyncTask, retryQuarantinedSyncTask } from '@/services/storage/sync';
import { buildSyncQueueChipModel, listQuarantinedOperations } from './syncQueueStatusPresentation';

/**
 * Chip «cambios pendientes de sincronizar» de la barra del censo. Invisible en
 * operación normal; aparece cuando lo pendiente envejece (guardado local sin
 * llegar al servidor) y en ámbar cuando hay tareas en cuarentena
 * (FAILED/CONFLICT), con un popover que muestra la taxonomía del error y las
 * acciones Reintentar / Descartar por tarea. El estado sale del monitor de la
 * cola (polling); las acciones refrescan de inmediato.
 */

interface SyncQueueStatusChipProps {
  /** Estado del popover, controlado por la barra (para elevar su z-index). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SyncQueueStatusChip: React.FC<SyncQueueStatusChipProps> = ({ open, onOpenChange }) => {
  const { stats, operations, refresh } = useSyncQueueMonitor({ operationLimit: 12 });
  const [busyTaskId, setBusyTaskId] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const model = buildSyncQueueChipModel(stats);
  const quarantined = listQuarantinedOperations(operations);
  const visible = model.tone !== 'hidden';

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!visible && open) onOpenChange(false);
  }, [visible, open, onOpenChange]);

  if (!visible) return null;

  const runTaskAction = async (
    taskId: number,
    action: (taskId: number) => Promise<boolean>
  ): Promise<void> => {
    setBusyTaskId(taskId);
    try {
      await action(taskId);
      await refresh();
    } finally {
      setBusyTaskId(null);
    }
  };

  const attention = model.tone === 'attention';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="sync-queue-status-panel"
        title={model.title}
        data-testid="sync-queue-status-chip"
        className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
          attention
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            : 'border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700'
        }`}
      >
        <CloudUpload size={13} className={attention ? '' : 'animate-pulse'} aria-hidden="true" />
        {model.label}
      </button>
      {attention && (
        <span className="sr-only" role="status">
          {model.title}
        </span>
      )}
      {open && (
        <div
          id="sync-queue-status-panel"
          data-testid="sync-queue-status-panel"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Cambios pendientes de sincronizar
          </p>
          {stats.pending > 0 && (
            <p className="mb-2 text-[11px] leading-snug text-slate-600">
              {stats.pending} en cola{stats.retrying > 0 ? ` · ${stats.retrying} reintentando` : ''}
              . Se sincronizan solos al recuperar conexión.
            </p>
          )}
          {quarantined.length === 0 ? (
            stats.pending === 0 && (
              <p className="text-[11px] leading-snug text-slate-500">Todo sincronizado.</p>
            )
          ) : (
            <ul className="space-y-2">
              {quarantined.map(operation => (
                <li
                  key={operation.id}
                  className="rounded-lg border border-amber-200 bg-amber-50/60 p-2"
                  data-testid="sync-queue-quarantined-op"
                >
                  <p className="text-[11px] font-semibold text-slate-700">
                    {operation.targetLabel}
                    <span className="ml-1.5 font-medium text-amber-700">
                      {operation.statusLabel} · {operation.categoryLabel}
                    </span>
                  </p>
                  {operation.actionHint && (
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                      {operation.actionHint}
                      {operation.attemptsLabel ? ` · ${operation.attemptsLabel}` : ''}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => void runTaskAction(operation.id, retryQuarantinedSyncTask)}
                      disabled={busyTaskId !== null}
                      data-testid="sync-queue-op-retry"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-progress disabled:opacity-60"
                    >
                      <RefreshCw
                        size={11}
                        className={busyTaskId === operation.id ? 'animate-spin' : ''}
                      />
                      Reintentar
                    </button>
                    <button
                      type="button"
                      onClick={() => void runTaskAction(operation.id, discardQuarantinedSyncTask)}
                      disabled={busyTaskId !== null}
                      title="Descarta este envío en cola; lo guardado en este equipo no se toca."
                      data-testid="sync-queue-op-discard"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-progress disabled:opacity-60"
                    >
                      <Trash2 size={11} />
                      Descartar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
