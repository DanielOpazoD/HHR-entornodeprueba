import React from 'react';
import { CircleHelp, History, RefreshCw, UsersRound } from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useRayenImport } from '../hooks/useRayenImport';
import { useRayenFillProgress } from '../hooks/useRayenFillStatus';
import { useRayenExtensionHealth } from '../hooks/useRayenExtensionHealth';
import { RayenImportPreviewModal } from './RayenImportPreviewModal';
import { RayenImportFlowStatus } from './RayenImportFlowStatus';
import { RayenSyncHistoryModal } from './RayenSyncHistoryModal';
import { RayenNursingShiftProposalModal } from './RayenNursingShiftProposalModal';
import { presentRayenSyncRecovery, rayenPrimaryActionLabel } from './rayenSyncPresentation';
import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import {
  isRayenSyncExecutionActive,
  rayenSyncExecutionDate,
} from '../hooks/rayenSyncExecutionState';

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

interface RayenImportButtonProps {
  selectedDate?: string;
}

export const RayenImportButton: React.FC<RayenImportButtonProps> = ({ selectedDate }) => {
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [recoveryBusy, setRecoveryBusy] = React.useState(false);
  const [connectionGuidanceOpen, setConnectionGuidanceOpen] = React.useState(false);
  const [staffingReviewOpen, setStaffingReviewOpen] = React.useState(false);
  const historyTriggerRef = React.useRef<HTMLButtonElement>(null);
  const {
    mode,
    execution,
    diff,
    isPreviewOpen,
    isBusy,
    isSyncing,
    result,
    hasSkippedItems,
    error,
    staffingProposal,
    isStaffingProposalBusy,
    staffingProposalError,
    refreshStaffingProposal,
    triggerImport,
    retryClinicalFill,
    confirm,
    cancel,
    confirmStaffingProposal,
    dismissStaffingProposal,
  } = useRayenImport(selectedDate);

  const { record } = useDailyRecordData();
  const fill = useRayenFillProgress();
  const extension = useRayenExtensionHealth();
  const mainWorking =
    isRayenSyncExecutionActive(execution?.stage ?? null) ||
    isSyncing ||
    isBusy ||
    fill.running ||
    recoveryBusy;
  const working = mainWorking || isStaffingProposalBusy;
  const selectedRecordIsCurrent = !selectedDate || record?.date === selectedDate;
  const recordForSelectedDate = selectedRecordIsCurrent ? record : null;
  const executionTargetDate = execution?.stage ? rayenSyncExecutionDate(execution) : null;
  const targetDate = executionTargetDate ?? selectedDate ?? recordForSelectedDate?.date ?? null;
  const historyTargetDate = recordForSelectedDate?.date ?? selectedDate ?? targetDate;

  const lastSync = recordForSelectedDate?.rayenSync
    ? formatLastSync(recordForSelectedDate.rayenSync)
    : null;
  const history = React.useMemo(
    () =>
      (recordForSelectedDate?.rayenSyncHistory ?? [])
        .slice()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [recordForSelectedDate?.rayenSyncHistory]
  );
  const recovery = React.useMemo(
    () => presentRayenSyncRecovery(history[0], extension.connection, mainWorking),
    [extension.connection, history, mainWorking]
  );

  const sourceState =
    extension.connection === 'checking'
      ? 'Comprobando'
      : extension.connection === 'ready'
        ? 'Conectada'
        : extension.connection === 'degraded'
          ? 'Conexión parcial'
          : extension.connection === 'incompatible'
            ? 'Actualizar extensión'
            : extension.connection === 'blocked'
              ? extension.report?.fichaMedico.status === 'ready'
                ? 'Conectar Gestión de Camas'
                : 'Revisar Ficha Médico'
              : 'Extensión sin respuesta';
  const needsConnectionGuidance =
    extension.connection !== 'ready' && extension.connection !== 'checking';
  const connectionGuidance = needsConnectionGuidance
    ? `Eloísa requiere atención. ${extension.message}`
    : 'Eloísa está disponible para sincronizar.';

  const handleSync = async (): Promise<void> => {
    const startedAt = Date.now();
    const health = await extension.refresh();
    await triggerImport(health, {
      stagesMs: { preflight: elapsedMilliseconds(startedAt) },
      counters: { requests: 1 },
    });
  };
  const pendingChangeCount = diff
    ? diff.summary.admissions +
      diff.summary.updates +
      diff.summary.moves +
      diff.summary.discharges +
      (diff.reportEgresos?.length ?? 0)
    : 0;
  const primaryActionLabel =
    isPreviewOpen && !result && pendingChangeCount > 0
      ? `Revisar ${pendingChangeCount} cambio${pendingChangeCount === 1 ? '' : 's'}`
      : isPreviewOpen && result
        ? 'Revisar conflictos'
        : rayenPrimaryActionLabel(extension.connection, mainWorking);

  React.useEffect(() => {
    if (!staffingProposal) setStaffingReviewOpen(false);
  }, [staffingProposal]);

  const handleConfirmStaffingProposal = async (): Promise<void> => {
    if (await confirmStaffingProposal()) setStaffingReviewOpen(false);
  };
  const handleDismissStaffingProposal = (): void => {
    dismissStaffingProposal();
    setStaffingReviewOpen(false);
  };
  const handleStaffingReview = async (): Promise<void> => {
    if (!selectedRecordIsCurrent) return;
    const health = await extension.refresh();
    const fichaMedicoReady =
      health.connection === 'ready' || health.report?.fichaMedico.status === 'ready';
    if (!fichaMedicoReady) {
      setConnectionGuidanceOpen(true);
      return;
    }
    const proposal = await refreshStaffingProposal();
    if (proposal) setStaffingReviewOpen(true);
  };
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
        if (history[0]?.status === 'applied') await retryClinicalFill();
        else await handleSync();
      } else {
        await extension.refresh();
      }
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <div
      className={`w-full rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        connectionGuidanceOpen ? 'relative z-[39]' : ''
      }`}
      data-testid="rayen-operations-bar"
    >
      <div className="grid min-h-[3.75rem] grid-cols-1 items-center gap-2 px-3 py-1.5 xl:grid-cols-[minmax(190px,0.78fr)_minmax(260px,1.4fr)_auto]">
        <div className="relative flex min-w-[210px] items-center gap-2">
          <span
            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border ${
              working || extension.connection === 'checking'
                ? 'border-teal-200 bg-teal-100 text-teal-700'
                : extension.connection === 'ready'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : extension.connection === 'degraded'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <img
              src="/images/logos/rayen-mark.png"
              alt=""
              className="size-7 object-contain"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-bold leading-tight text-slate-800">Eloísa</p>
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
              <span className="truncate text-[11px] font-medium text-slate-500">{sourceState}</span>
              {needsConnectionGuidance && (
                <button
                  type="button"
                  onClick={() => setConnectionGuidanceOpen(open => !open)}
                  aria-expanded={connectionGuidanceOpen}
                  aria-controls="rayen-connection-guidance"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
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
            <p className="mt-0.5 truncate text-[10px] font-medium tabular-nums text-slate-500">
              {lastSync ? `Última ${lastSync}` : 'Aún sin sincronizar hoy'}
            </p>
            {needsConnectionGuidance && connectionGuidanceOpen && (
              <p
                id="rayen-connection-guidance"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-amber-900 shadow-lg"
              >
                {extension.message}
              </p>
            )}
          </div>
        </div>

        <RayenImportFlowStatus
          diff={result ? null : diff}
          fill={fill}
          isApplyingCensus={isBusy}
          isPreviewOpen={isPreviewOpen}
          isSyncing={isSyncing}
          error={error}
          hasPersistedSync={Boolean(lastSync)}
          persistedSync={recordForSelectedDate?.rayenSync}
          hasSkippedItems={hasSkippedItems || Boolean(result?.skipped.length)}
          hasUnresolvedConflicts={Boolean(diff?.summary.conflicts)}
          executionStage={execution?.stage}
          targetDate={targetDate}
        />

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-slate-200 xl:border-l xl:pl-2.5">
          <button
            ref={historyTriggerRef}
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={`Abrir historial de sincronización del día, ${history.length} eventos`}
            title={`Historial de sincronización · ${history.length} evento${history.length === 1 ? '' : 's'}`}
            data-testid="rayen-sync-history-button"
            className="relative inline-flex size-8 min-h-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <History size={14} aria-hidden="true" />
            {recovery && (
              <span
                className={`absolute -right-0.5 -top-0.5 size-2 rounded-full border border-white ${
                  working ? 'animate-pulse bg-slate-300' : 'bg-amber-500'
                }`}
                data-testid="rayen-sync-history-indicator"
                aria-hidden="true"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleStaffingReview()}
            disabled={!selectedRecordIsCurrent || mainWorking || isStaffingProposalBusy}
            aria-label="Sincronizar dotación clínica"
            aria-busy={isStaffingProposalBusy}
            title={
              staffingProposalError ??
              'Leer y revisar Enfermería y TENS sin modificar camas ni datos clínicos'
            }
            data-testid="rayen-staffing-review-button"
            className={`relative inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-50 ${
              staffingProposalError
                ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                : 'border-slate-200 text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700'
            }`}
          >
            {isStaffingProposalBusy ? (
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <UsersRound size={14} aria-hidden="true" />
            )}
            Dotación
            {staffingProposal && !isStaffingProposalBusy && (
              <span
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-white bg-teal-500"
                aria-hidden="true"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={working || extension.connection === 'checking' || isPreviewOpen}
            aria-busy={mainWorking || extension.connection === 'checking'}
            title={
              mode === 'auto'
                ? 'Sincronizar el censo con Eloísa (modo automático experimental)'
                : 'Sincronizar el censo con Eloísa (con revisión)'
            }
            data-module="rayen-import"
            data-testid="rayen-import-button"
            className="inline-flex min-h-8 w-40 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.1)] transition-colors hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-70"
          >
            <RefreshCw size={13} strokeWidth={2.5} className={mainWorking ? 'animate-spin' : ''} />
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
        isApplied={Boolean(result)}
        targetDate={targetDate}
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
        targetDate={historyTargetDate}
      />
      <RayenNursingShiftProposalModal
        proposal={!isPreviewOpen && staffingReviewOpen ? staffingProposal : null}
        isBusy={isStaffingProposalBusy}
        error={staffingProposalError}
        onConfirm={() => void handleConfirmStaffingProposal()}
        onCancel={handleDismissStaffingProposal}
      />
    </div>
  );
};
