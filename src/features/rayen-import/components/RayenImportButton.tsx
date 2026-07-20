import React from 'react';
import {
  CheckCircle2,
  CircleHelp,
  Clock3,
  DatabaseZap,
  History,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useRayenImport } from '../hooks/useRayenImport';
import { useRayenFillProgress } from '../hooks/useRayenFillStatus';
import { useRayenExtensionHealth } from '../hooks/useRayenExtensionHealth';
import { RayenImportPreviewModal } from './RayenImportPreviewModal';
import { RayenSyncHistoryModal } from './RayenSyncHistoryModal';
import { RayenNursingShiftProposalModal } from './RayenNursingShiftProposalModal';
import { RayenImportErrorNotice } from './RayenImportErrorNotice';
import {
  presentRayenCoverage,
  presentRayenSyncRecovery,
  rayenPrimaryActionLabel,
  rayenSyncStatusLabel,
} from './rayenSyncPresentation';
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
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [recoveryBusy, setRecoveryBusy] = React.useState(false);
  const [connectionGuidanceOpen, setConnectionGuidanceOpen] = React.useState(false);
  const historyTriggerRef = React.useRef<HTMLButtonElement>(null);
  const {
    mode,
    diff,
    isPreviewOpen,
    isBusy,
    isSyncing,
    error,
    staffingProposal,
    isStaffingProposalBusy,
    staffingProposalError,
    triggerImport,
    confirm,
    cancel,
    confirmStaffingProposal,
    dismissStaffingProposal,
  } = useRayenImport();

  const { record } = useDailyRecordData();
  const fill = useRayenFillProgress();
  const extension = useRayenExtensionHealth();
  const working = isSyncing || isBusy || fill.running || recoveryBusy || isStaffingProposalBusy;

  const lastSync = record?.rayenSync ? formatLastSync(record.rayenSync) : null;
  const history = React.useMemo(
    () =>
      (record?.rayenSyncHistory ?? [])
        .slice()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [record?.rayenSyncHistory]
  );
  const recovery = React.useMemo(
    () => presentRayenSyncRecovery(history[0], extension.connection, working),
    [extension.connection, history, working]
  );

  // Visible, verifiable fill status: live progress while running, then a completion summary with
  // the per-patient error count — so the user can tell whether devices/scores actually synced.
  const fillNote = fill.running
    ? `Datos clínicos ${fill.done}/${fill.total}…`
    : fill.lastCompletedAt
      ? fill.errors > 0
        ? `Datos clínicos: ${Math.max(fill.total - fill.errors, 0)}/${fill.total} · ${fill.errors} con error`
        : `Datos clínicos: ${fill.total}/${fill.total} ✓`
      : null;

  const sourceState =
    extension.connection === 'checking'
      ? 'Comprobando'
      : extension.connection === 'ready'
        ? `Conectada · v${extension.report?.version ?? ''}`
        : extension.connection === 'degraded'
          ? `Parcial · v${extension.report?.version ?? ''}`
          : extension.connection === 'incompatible'
            ? 'Actualizar extensión'
            : extension.connection === 'blocked'
              ? 'Revisar Ficha Médico'
              : 'Extensión sin respuesta';
  const responsibleState = lastSync ? (record?.rayenSync?.by ?? 'Sin identificar') : 'Sin registro';
  const persistedCoverage = presentRayenCoverage(
    record?.rayenSync?.coverage,
    Boolean(lastSync),
    record?.rayenSync?.status === 'applied' && Boolean(record.rayenSync.runId)
  );
  const coverageState = fill.running
    ? (fillNote?.replace('Datos clínicos: ', '').replace('Datos clínicos ', '') ?? 'Procesando…')
    : record?.rayenSync?.coverage
      ? persistedCoverage.label
      : fillNote
        ? fillNote.replace('Datos clínicos: ', '').replace('Datos clínicos ', '')
        : persistedCoverage.label;
  const coverageTone = fill.running
    ? 'running'
    : record?.rayenSync?.coverage
      ? persistedCoverage.tone
      : fillNote
        ? fill.errors > 0
          ? 'warning'
          : 'success'
        : 'muted';

  const fichaReady = extension.report?.fichaMedico.status === 'ready';
  const camasReady = extension.report?.gestionCamas.status === 'ready';
  const needsConnectionGuidance =
    extension.connection !== 'ready' && extension.connection !== 'checking';
  const connectionGuidance = needsConnectionGuidance
    ? `Eloísa requiere atención. ${extension.message}`
    : 'Eloísa está disponible para sincronizar.';

  const handleSync = async (): Promise<void> => {
    const health = await extension.refresh();
    triggerImport(health);
  };
  const primaryActionLabel = rayenPrimaryActionLabel(extension.connection, working);
  const persistedStatusLabel = rayenSyncStatusLabel(record?.rayenSync?.status);
  const persistedStatusClass =
    record?.rayenSync?.status === 'complete'
      ? 'text-emerald-700'
      : record?.rayenSync?.status === 'partial'
        ? 'text-amber-700'
        : 'text-sky-700';
  const closeHistory = React.useCallback(() => {
    setHistoryOpen(false);
    queueMicrotask(() => historyTriggerRef.current?.focus());
  }, []);
  const handleRecoveryAction = async (): Promise<void> => {
    if (!recovery?.action) return;
    setRecoveryBusy(true);
    try {
      if (recovery.action === 'retry') {
        closeHistory();
        await handleSync();
      } else {
        await extension.refresh();
      }
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      data-testid="rayen-operations-bar"
    >
      <div className="grid min-h-14 grid-cols-1 items-center gap-2 px-3 py-2 md:grid-cols-[minmax(205px,0.9fr)_minmax(280px,1.55fr)_13.5rem]">
        <div className="flex min-w-[205px] items-center gap-2.5">
          <span
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border ${
              working || extension.connection === 'checking'
                ? 'border-teal-200 bg-teal-100 text-teal-700'
                : extension.connection === 'ready'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : extension.connection === 'degraded'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
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
                  working || extension.connection === 'checking'
                    ? 'animate-pulse bg-teal-500'
                    : extension.connection === 'ready'
                      ? 'bg-emerald-500'
                      : extension.connection === 'degraded'
                        ? 'bg-amber-500'
                        : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium text-slate-500">{sourceState}</span>
              {needsConnectionGuidance && (
                <button
                  type="button"
                  onClick={() => setConnectionGuidanceOpen(open => !open)}
                  aria-expanded={connectionGuidanceOpen}
                  aria-controls="rayen-connection-guidance"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
                  title={connectionGuidance}
                  aria-label={connectionGuidance}
                  data-testid="rayen-extension-health-help"
                >
                  <CircleHelp size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            {needsConnectionGuidance && (
              <span className="sr-only" role="status">
                {connectionGuidance}
              </span>
            )}
            <p
              className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"
              title={extension.message}
              data-testid="rayen-extension-health"
            >
              <span className={fichaReady ? 'text-emerald-700' : 'text-amber-700'}>
                Ficha {fichaReady ? '✓' : '—'}
              </span>
              <span aria-hidden="true">·</span>
              <span className={camasReady ? 'text-emerald-700' : 'text-amber-700'}>
                Camas {camasReady ? '✓' : '—'}
              </span>
            </p>
            {needsConnectionGuidance && connectionGuidanceOpen && (
              <p
                id="rayen-connection-guidance"
                className="mt-1 rounded-md bg-amber-50/80 px-2 py-1 text-[10px] leading-relaxed text-amber-900"
              >
                {extension.message}
              </p>
            )}
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
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] font-semibold tabular-nums text-slate-700">
              {lastSync ?? 'Sin sincronización registrada'}
              {lastSync && persistedStatusLabel && (
                <span className={persistedStatusClass}>· {persistedStatusLabel}</span>
              )}
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
                coverageTone === 'running'
                  ? 'animate-pulse text-teal-700 motion-reduce:animate-none'
                  : coverageTone === 'warning'
                    ? 'text-amber-700'
                    : coverageTone === 'success'
                      ? 'text-emerald-700'
                      : 'text-slate-400'
              }`}
              data-testid="rayen-fill-status"
            >
              {coverageState}
            </p>
          </div>
        </div>

        <div className="flex w-[13.5rem] shrink-0 items-center justify-end gap-2">
          <button
            ref={historyTriggerRef}
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={`Abrir historial de sincronización del día, ${history.length} eventos`}
            title={`Historial de sincronización · ${history.length} evento${history.length === 1 ? '' : 's'}`}
            data-testid="rayen-sync-history-button"
            className="relative inline-flex size-9 min-h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <History size={15} aria-hidden="true" />
            {history.length > 0 && (
              <span
                className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-white bg-slate-600 px-1 text-[9px] font-bold leading-4 tabular-nums text-white shadow-sm"
                aria-hidden="true"
              >
                {history.length > 9 ? '9+' : history.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={working || extension.connection === 'checking'}
            aria-busy={working || extension.connection === 'checking'}
            title={
              mode === 'auto'
                ? 'Sincronizar el censo con Eloísa (modo automático experimental)'
                : 'Sincronizar el censo con Eloísa (con revisión)'
            }
            data-module="rayen-import"
            data-testid="rayen-import-button"
            className="inline-flex min-h-9 w-[10.75rem] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-colors hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-70"
          >
            <RefreshCw size={15} strokeWidth={2.5} className={working ? 'animate-spin' : ''} />
            {primaryActionLabel}
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
      <RayenSyncHistoryModal
        isOpen={historyOpen}
        onClose={closeHistory}
        history={history}
        recovery={recovery}
        recoveryBusy={working}
        onRecoveryAction={() => void handleRecoveryAction()}
      />
      <RayenNursingShiftProposalModal
        proposal={staffingProposal}
        isBusy={isStaffingProposalBusy}
        error={staffingProposalError}
        onConfirm={() => void confirmStaffingProposal()}
        onCancel={dismissStaffingProposal}
      />

      <RayenImportErrorNotice error={error} isPreviewOpen={isPreviewOpen} />
    </div>
  );
};
