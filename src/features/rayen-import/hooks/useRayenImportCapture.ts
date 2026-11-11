import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type {
  CapturePreparationLock,
  RayenImportCaptureOptions,
  RayenImportTriggerOutcome,
} from './rayenImportCaptureContracts';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import { classifyRayenSnapshotError } from '../domain/rayenSnapshotErrorClassification';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import * as rayenImportBridge from '../bridge/rayenSnapshotBridge';
import type { RayenExtensionHealthState } from './useRayenExtensionHealth';
import { resetRayenFillProgress } from './useRayenFillStatus';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import type { RayenSyncRequestController } from './rayenSyncRequestLifecycle';
import type {
  RayenCaptureFailureCheck,
  RayenSyncFailureReason,
  RayenSyncPerformanceDelta,
} from '@/types/domain/rayenSync';
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
  executionRef: RefObject<RayenSyncExecutionState>;
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
    policy?: RayenImportPolicy,
    reviewRequirement?: RayenImportCaptureOptions['reviewRequirement']
  ) => RayenSyncRun;
  failRun: (
    reason: RayenSyncFailureReason,
    runId?: string,
    error?: unknown,
    captureCheck?: RayenCaptureFailureCheck
  ) => Promise<void>;
  cancelRun?: () => void;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  previewSnapshot: (
    snapshot: RayenCensusSnapshot,
    bundle: RayenSyncBundle,
    runId: string,
    requestId: string
  ) => void;
}

/** Longer than the extension's 3 s health cache, so the second attempt probes the tab afresh. */
export const GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS = 5000;

/** Gestión de Camas messages that ask a person to act; repeating the read would not help. */
const GESTION_CAMAS_NEEDS_PERSON =
  /vencio|inicia sesion|pestana nueva|no esta abierta|completa el acceso|permiso|recarga/;

/** Delay before the one silent retry of a failure that passes on its own; null = tell the person. */
const passingCaptureRetryDelayMs = (error: string, stage?: string): number | null => {
  if (stage === 'ficha_main_relay' || stage === 'ficha_tab_relay') return 0;
  const { reason } = classifyRayenSnapshotError(error, stage);
  if (reason === 'snapshot_network_error') return 0;
  const normalized = error.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return reason === 'gestion_camas_unavailable' && !GESTION_CAMAS_NEEDS_PERSON.test(normalized)
    ? GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS
    : null;
};

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
  const relayRetryRunRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // This lock exists only before the request starts; committed work keeps converging.
      if (capturePreparationLockRef.current) dispatchExecution({ type: 'cancel' });
      capturePreparationLockRef.current = null;
    };
  }, [dispatchExecution]);
  const startCaptureRequest = useCallback(
    ({ range, selectedDate }: PreparedRayenSyncContext, runId: string): string => {
      const requestId = syncRequestController.start(range.dateStart, range.dateEnd, runId, () => {
        // A capture timer owns only the wait for that response, never later review or
        // persistence. Derive this guard from the stage rather than a parallel UI flag.
        if (
          executionRef.current.stage?.type !== 'capturing' ||
          !isRayenSyncExecutionCurrent(executionRef.current, {
            runId: runId,
            requestId,
            selectedDate,
          })
        ) {
          return;
        }
        dispatchExecution({
          type: 'transition',
          runId: runId,
          requestId,
          selectedDate,
          stage: { type: 'failed' },
        });
        preparedSyncContextRef.current = null;
        recordRunPerformance({ counters: { timeouts: 1 } }, runId);
        void failRun('snapshot_timeout', runId, undefined, 'capture_no_answer');
        setState(previous => ({
          ...previous,
          error:
            'No se recibió la captura de Eloísa dentro del plazo. Verifica que ambas fuentes sigan conectadas y vuelve a intentarlo.',
        }));
      });
      return requestId;
    },
    [
      dispatchExecution,
      executionRef,
      failRun,
      preparedSyncContextRef,
      recordRunPerformance,
      setState,
      syncRequestController,
    ]
  );
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
      rayenImportBridge.subscribeToRayenImportErrors(
        (error, requestId, timeoutStage, captureRetries) => {
          const runId = syncRequestController.getRunId(requestId);
          if (!runId) return;
          const selectedDate = preparedSyncContextRef.current?.selectedDate;
          if (
            !isRayenSyncExecutionCurrent(executionRef.current, { runId, requestId, selectedDate })
          ) {
            return;
          }
          // A Ficha Médico tab idle for hours can miss its first read and answer the next in seconds.
          // A dropped connection also passes on its own (twice in 6 days, the next click worked).
          // Gestión de Camas «no disponible» failed 4 of 102 runs in 13 days and the next click,
          // 1–2 minutes later, always worked. The capture only reads, so it gets one silent retry
          // before anyone is told; Gestión de Camas first gets a few seconds to wake up.
          const prepared = preparedSyncContextRef.current;
          const retryDelayMs = passingCaptureRetryDelayMs(error, timeoutStage);
          if (
            retryDelayMs !== null &&
            prepared &&
            executionRef.current.context &&
            relayRetryRunRef.current !== runId
          ) {
            relayRetryRunRef.current = runId;
            recordRunPerformance({ counters: { retries: 1 } }, runId);
            const retry = () => {
              // A cancel, a new run or leaving the page while waiting ends the retry; the request's
              // own timeout stays armed meanwhile, so the run never hangs in «capturing».
              const context = executionRef.current.context;
              if (
                !mountedRef.current ||
                !context ||
                preparedSyncContextRef.current !== prepared ||
                !isRayenSyncExecutionCurrent(executionRef.current, {
                  runId,
                  requestId,
                  selectedDate,
                })
              ) {
                return;
              }
              const retryRequestId = startCaptureRequest(prepared, runId);
              dispatchExecution({
                type: 'activate',
                context: { ...context, requestId: retryRequestId },
              });
            };
            if (retryDelayMs === 0) retry();
            else setTimeout(retry, retryDelayMs);
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
          // Persist only the category and bounded counters, never the raw source error.
          if (captureRetries)
            recordRunPerformance({ counters: { retries: captureRetries } }, runId);
          const classified = classifyRayenSnapshotError(error, timeoutStage);
          void failRun(classified.reason, runId, undefined, classified.check);
          setState(previous => ({
            ...previous,
            error: classified.message,
          }));
        }
      ),
    [
      clearSyncTimeout,
      recordRunPerformance,
      startCaptureRequest,
      dispatchExecution,
      failRun,
      executionRef,
      preparedSyncContextRef,
      setState,
      syncRequestController,
    ]
  );

  return useCallback(
    async (
      health: RayenExtensionHealthState,
      performance?: RayenSyncPerformanceDelta,
      options?: RayenImportCaptureOptions
    ): Promise<RayenImportTriggerOutcome> => {
      if (!mountedRef.current) return 'blocked';
      const requestedSelectedDate =
        routeSelectedDate ?? (currentRecord ? toIsoReportDate(currentRecord) : 'no-record');
      const activeExecution = executionRef.current;
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
          return 'already_running';
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
        executionRef.current.stage?.type !== 'cancelled'
      ) {
        return 'already_running';
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
            result: null,
            hasSkippedItems: false,
            // Solo 'loading' llega aquí sin razón de bloqueo: el botón no se deshabilita
            // mientras carga, así que el clic prematuro merece su propio mensaje, no un silencio.
            error:
              resolveRayenPolicyBlockMessage(policyStatus) ??
              'La política global de sincronización aún se está cargando. Reintenta en unos segundos.',
          }));
          return 'blocked';
        }
        if (!health.canSync) {
          setState(previous => ({
            ...previous,
            result: null,
            hasSkippedItems: false,
            error: null,
          }));
          return 'blocked';
        }
        if (!resetRayenFillProgress()) {
          setState(previous => ({
            ...previous,
            result: null,
            hasSkippedItems: false,
            error:
              'La revisión clínica anterior todavía está terminando. Espera un momento antes de sincronizar nuevamente.',
          }));
          return 'blocked';
        }
        setStaffingProposal(null);
        setStaffingProposalError(null);
        if (!currentRecord || toIsoReportDate(currentRecord) !== requestedSelectedDate) {
          setState(previous => ({
            ...previous,
            result: null,
            hasSkippedItems: false,
            error: currentRecord
              ? 'El censo seleccionado todavía está cargando. Espera un momento antes de sincronizar.'
              : 'No hay un censo cargado para sincronizar.',
          }));
          return 'blocked';
        }
        const run = startRun(health, performance, policy, options?.reviewRequirement);
        const selectedDate = toIsoReportDate(currentRecord);
        dispatchExecution({ type: 'prepare', runId: run.id, selectedDate });
        const generation = getSessionGeneration();
        const isPreparationCurrent = (): boolean => {
          const ownsLock = capturePreparationLockRef.current === preparationLock;
          const current = mountedRef.current && ownsLock && generation === getSessionGeneration();
          if (!current && ownsLock) dispatchExecution({ type: 'cancel', runId: run.id });
          return (
            current &&
            isRayenSyncExecutionCurrent(executionRef.current, { runId: run.id, selectedDate })
          );
        };

        setState(previous => ({
          ...previous,
          diff: null,
          isPreviewOpen: false,
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
            throw new Error('Selecciona una fecha de censo válida, actual o pasada.');
          }
        } catch (error) {
          if (!isPreparationCurrent()) {
            return 'started';
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
            result: null,
            hasSkippedItems: false,
            error: getRayenImportErrorMessage(error),
          }));
          return 'started';
        }

        // The selected date or active execution may have changed while the authoritative census
        // was loading. Never start an extension request for an obsolete temporal context.
        if (!isPreparationCurrent()) {
          return 'started';
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
        const requestId = startCaptureRequest(preparedContext, run.id);
        dispatchExecution({
          type: 'activate',
          context: createRayenSyncExecutionContext(preparedContext, requestId, policy),
        });
        recordRunPerformance({ counters: { requests: 1 } }, run.id);
        return 'started';
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
      startCaptureRequest,
      startRun,
    ]
  );
};
