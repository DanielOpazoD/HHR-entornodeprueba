import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import * as rayenImportBridge from '../bridge/rayenImportBridge';
import type { RayenExtensionHealthState } from './useRayenExtensionHealth';
import { failureReasonFromHealth } from './useRayenSyncAudit';
import { resetRayenFillProgress } from './useRayenFillStatus';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import type { RayenSyncRequestController } from './rayenSyncRequestLifecycle';
import type { RayenSyncFailureReason, RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import type { RayenImportPolicy } from '../settings/rayenImportSettings';
import { resolveRayenPolicyBlockMessage, type RayenImportPolicyStatus } from './useRayenImportMode';
import {
  createRayenSyncExecutionContext,
  prepareRayenSyncTemporalContext,
  type PreparedRayenSyncContext,
} from './rayenSyncTemporalContext';
import { toIsoReportDate } from './reportDateHelpers';
import {
  isRayenSyncExecutionCancellableBeforeCommit,
  isRayenSyncExecutionCurrent,
  isRayenSyncExecutionSettled,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionState,
} from './rayenSyncExecutionState';

interface UseRayenImportCaptureInput {
  currentRecord: DailyRecord | null | undefined;
  /** Route-selected census date; it changes before the matching record finishes loading. */
  selectedDate?: string;
  policy: RayenImportPolicy;
  policyStatus: RayenImportPolicyStatus;
  dispatchExecution?: Dispatch<RayenSyncExecutionAction>;
  executionRef?: RefObject<RayenSyncExecutionState>;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  setStaffingProposal: Dispatch<SetStateAction<NursingStaffingProposal | null>>;
  setStaffingProposalError: Dispatch<SetStateAction<string | null>>;
  clearSyncTimeout: () => void;
  syncRequestController: RayenSyncRequestController;
  preparedSyncContextRef: RefObject<PreparedRayenSyncContext | null>;
  loadFreshRecord: (date: string) => Promise<DailyRecord>;
  startRun: (
    health?: RayenExtensionHealthState,
    performance?: RayenSyncPerformanceDelta,
    policy?: RayenImportPolicy
  ) => RayenSyncRun;
  failRun: (reason: RayenSyncFailureReason, runId?: string) => Promise<void>;
  cancelRun?: () => void;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  previewSnapshot: (
    snapshot: RayenCensusSnapshot,
    bundle: RayenSyncBundle,
    runId: string,
    requestId: string
  ) => void;
}

interface CapturePreparationLock {
  lockId: symbol;
  selectedDate: string;
}

/** Owns extension capture subscriptions and the preflight/request lifecycle for one import flow. */
export const useRayenImportCapture = ({
  currentRecord,
  selectedDate: routeSelectedDate,
  policy,
  policyStatus,
  dispatchExecution = () => undefined,
  executionRef,
  setState,
  setStaffingProposal,
  setStaffingProposalError,
  clearSyncTimeout,
  syncRequestController,
  preparedSyncContextRef,
  loadFreshRecord,
  startRun,
  failRun,
  cancelRun,
  recordRunPerformance,
  previewSnapshot,
}: UseRayenImportCaptureInput) => {
  const capturePreparationLockRef = useRef<CapturePreparationLock | null>(null);
  useEffect(
    () =>
      rayenImportBridge.subscribeToRayenSnapshots((snapshot, bundle, requestId) => {
        const runId = syncRequestController.getRunId(requestId);
        if (!runId) return;
        previewSnapshot(snapshot, bundle, runId, requestId);
      }),
    [previewSnapshot, syncRequestController]
  );

  useEffect(
    () =>
      rayenImportBridge.subscribeToRayenImportErrors((_error, requestId) => {
        const runId = syncRequestController.getRunId(requestId);
        if (!runId) return;
        const selectedDate = preparedSyncContextRef.current?.selectedDate;
        if (
          !isRayenSyncExecutionCurrent(executionRef?.current, { runId, requestId, selectedDate })
        ) {
          return;
        }
        clearSyncTimeout();
        dispatchExecution({
          type: 'transition',
          runId,
          requestId,
          selectedDate: preparedSyncContextRef.current?.selectedDate,
          stage: { type: 'failed' },
        });
        preparedSyncContextRef.current = null;
        void failRun('snapshot_error', runId);
        setState(previous => ({
          ...previous,
          isBusy: false,
          isSyncing: false,
          error:
            'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen e inténtalo nuevamente.',
        }));
      }),
    [
      clearSyncTimeout,
      dispatchExecution,
      failRun,
      executionRef,
      preparedSyncContextRef,
      setState,
      syncRequestController,
    ]
  );

  return useCallback(
    async (health: RayenExtensionHealthState, performance?: RayenSyncPerformanceDelta) => {
      const requestedSelectedDate =
        routeSelectedDate ?? (currentRecord ? toIsoReportDate(currentRecord) : 'no-record');
      const activeExecution = executionRef?.current;
      if (activeExecution && !isRayenSyncExecutionSettled(activeExecution.stage)) {
        const activeSelectedDate =
          activeExecution.context?.selectedDate ?? activeExecution.pending?.selectedDate;
        // Repeated clicks for one date are idempotent. A different selected date may supersede
        // only pre-commit work; once structural persistence starts, its correlated execution must
        // converge even if the operator navigates elsewhere.
        if (
          activeSelectedDate === requestedSelectedDate ||
          !isRayenSyncExecutionCancellableBeforeCommit(activeExecution.stage)
        ) {
          return;
        }
        const activeRunId = activeExecution.context?.runId ?? activeExecution.pending?.runId;
        clearSyncTimeout();
        preparedSyncContextRef.current = null;
        dispatchExecution({ type: 'cancel', runId: activeRunId });
        cancelRun?.();
      }
      const activeLock = capturePreparationLockRef.current;
      if (
        activeLock?.selectedDate === requestedSelectedDate &&
        executionRef?.current.stage?.type !== 'cancelled'
      ) {
        return;
      }
      const preparationLock: CapturePreparationLock = {
        lockId: Symbol('rayen-capture-preparation'),
        selectedDate: requestedSelectedDate,
      };
      capturePreparationLockRef.current = preparationLock;
      try {
        // A new user attempt owns the presentation immediately, even if preflight fails before a
        // run/request can be created. Otherwise a prior terminal state can hide the new error.
        dispatchExecution({ type: 'reset' });
        clearSyncTimeout();
        preparedSyncContextRef.current = null;
        if (policyStatus !== 'ready') {
          setState(previous => ({
            ...previous,
            isBusy: false,
            isSyncing: false,
            result: null,
            hasSkippedItems: false,
            // Solo 'loading' llega aquí sin razón de bloqueo ('ready' no entra
            // en esta rama): el botón no se deshabilita mientras carga, así
            // que el clic prematuro merece su propio mensaje, no un silencio.
            error:
              resolveRayenPolicyBlockMessage(policyStatus) ??
              'La política global de sincronización aún se está cargando. Reintenta en unos segundos.',
          }));
          return;
        }
        if (!resetRayenFillProgress()) {
          setState(previous => ({
            ...previous,
            isSyncing: false,
            result: null,
            hasSkippedItems: false,
            error:
              'La revisión clínica anterior todavía está terminando. Espera un momento antes de sincronizar nuevamente.',
          }));
          return;
        }
        setStaffingProposal(null);
        setStaffingProposalError(null);
        if (!currentRecord || toIsoReportDate(currentRecord) !== requestedSelectedDate) {
          setState(previous => ({
            ...previous,
            isBusy: false,
            isSyncing: false,
            result: null,
            hasSkippedItems: false,
            error: currentRecord
              ? 'El censo seleccionado todavía está cargando. Espera un momento antes de sincronizar.'
              : 'No hay un censo cargado para sincronizar.',
          }));
          return;
        }
        const run = startRun(health, performance, policy);
        if (!health.canSync) {
          preparedSyncContextRef.current = null;
          void failRun(failureReasonFromHealth(health), run.id);
          setState(previous => ({
            ...previous,
            isSyncing: false,
            result: null,
            hasSkippedItems: false,
            error: null,
          }));
          return;
        }
        const selectedDate = toIsoReportDate(currentRecord);
        dispatchExecution({ type: 'prepare', runId: run.id, selectedDate });

        setState(previous => ({
          ...previous,
          diff: null,
          isPreviewOpen: false,
          isBusy: false,
          isSyncing: true,
          result: null,
          hasSkippedItems: false,
          error: null,
        }));

        let preparedContext: PreparedRayenSyncContext;
        try {
          preparedContext = await prepareRayenSyncTemporalContext({
            displayedRecord: currentRecord,
            runId: run.id,
            loadFreshRecord,
          });
          // Reject unsupported historical targets before starting the extension request. Keeping
          // this validation inside the preparation boundary also guarantees a terminal execution
          // state instead of leaving an orphan request in `preparing_context`.
          if (
            preparedContext.target.kind === 'unsupported' ||
            preparedContext.target.lookbackDays === null
          ) {
            throw new Error(
              'Solo se puede sincronizar el censo vigente o uno de los siete días anteriores.'
            );
          }
        } catch (error) {
          if (
            !isRayenSyncExecutionCurrent(executionRef?.current, {
              runId: run.id,
              selectedDate,
            })
          ) {
            return;
          }
          dispatchExecution({
            type: 'transition',
            runId: run.id,
            selectedDate,
            stage: { type: 'failed' },
          });
          preparedSyncContextRef.current = null;
          void failRun('snapshot_error', run.id);
          setState(previous => ({
            ...previous,
            isSyncing: false,
            result: null,
            hasSkippedItems: false,
            error: getRayenImportErrorMessage(error),
          }));
          return;
        }

        // The selected date or active execution may have changed while the authoritative census
        // was loading. Never start an extension request for an obsolete temporal context.
        if (
          !isRayenSyncExecutionCurrent(executionRef?.current, {
            runId: run.id,
            selectedDate,
          })
        ) {
          return;
        }

        preparedSyncContextRef.current = preparedContext;
        recordRunPerformance(
          {
            coordination: {
              target: preparedContext.target.kind === 'current' ? 'current' : 'historical',
            },
          },
          run.id
        );
        const requestId = syncRequestController.start(
          preparedContext.range.dateStart,
          preparedContext.range.dateEnd,
          run.id,
          () => {
            if (
              !isRayenSyncExecutionCurrent(executionRef?.current, {
                runId: run.id,
                requestId,
                selectedDate,
              })
            ) {
              return;
            }
            dispatchExecution({
              type: 'transition',
              runId: run.id,
              requestId,
              selectedDate,
              stage: { type: 'failed' },
            });
            preparedSyncContextRef.current = null;
            recordRunPerformance({ counters: { timeouts: 1 } }, run.id);
            void failRun('snapshot_timeout', run.id);
            setState(previous =>
              previous.isSyncing
                ? {
                    ...previous,
                    isSyncing: false,
                    error:
                      'No se recibió respuesta de la extensión Rayen. Verifica que Ficha Médico y Gestión de Camas estén abiertas y conectadas.',
                  }
                : previous
            );
          }
        );
        dispatchExecution({
          type: 'activate',
          context: createRayenSyncExecutionContext(preparedContext, requestId, policy),
        });
        recordRunPerformance({ counters: { requests: 1 } }, run.id);
      } finally {
        // An obsolete preparation can finish after a newer selected date has acquired the lock.
        // Never release the newer execution's lock from the older callback.
        if (capturePreparationLockRef.current?.lockId === preparationLock.lockId) {
          capturePreparationLockRef.current = null;
        }
      }
    },
    [
      clearSyncTimeout,
      cancelRun,
      currentRecord,
      dispatchExecution,
      failRun,
      executionRef,
      loadFreshRecord,
      preparedSyncContextRef,
      recordRunPerformance,
      routeSelectedDate,
      policy,
      policyStatus,
      setStaffingProposal,
      setStaffingProposalError,
      setState,
      startRun,
      syncRequestController,
    ]
  );
};
