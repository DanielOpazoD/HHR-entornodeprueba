import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { removeAccents } from '@/utils/stringUtils';
import type {
  RayenCaptureFailureCheck,
  RayenSyncFailureReason,
  RayenSyncPerformanceDelta,
} from '@/types/domain/rayenSync';
import * as rayenImportBridge from '../bridge/rayenSnapshotBridge';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { classifyRayenSnapshotError } from '../domain/rayenSnapshotErrorClassification';
import type { RayenImportState } from './rayenImportState';
import {
  isRayenSyncExecutionCurrent,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionState,
} from './rayenSyncExecutionState';
import type { RayenSyncRequestController } from './rayenSyncRequestLifecycle';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';

/** Longer than the extension's 3 s health cache, so the second attempt probes the tab afresh. */
export const GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS = 5000;

/** Brief backoff before the silent retry of a transient network drop so Eloísa can recover. */
export const SNAPSHOT_NETWORK_CAPTURE_RETRY_DELAY_MS = 3500;

/** Gestión de Camas messages that ask a person to act; repeating the read would not help. */
const GESTION_CAMAS_NEEDS_PERSON =
  /vencio|inicia sesion|pestana nueva|no esta abierta|completa el acceso|permiso|recarga/;

/** Delay before the one silent retry of a failure that passes on its own; null = tell the person. */
const passingCaptureRetryDelayMs = (error: string, stage?: string): number | null => {
  if (stage === 'ficha_main_relay' || stage === 'ficha_tab_relay') return 0;
  const { reason } = classifyRayenSnapshotError(error, stage);
  if (reason === 'snapshot_network_error') return SNAPSHOT_NETWORK_CAPTURE_RETRY_DELAY_MS;
  const normalized = removeAccents(error).toLowerCase();
  return reason === 'gestion_camas_unavailable' && !GESTION_CAMAS_NEEDS_PERSON.test(normalized)
    ? GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS
    : null;
};

interface UseRayenImportCaptureSubscriptionsInput {
  mountedRef: RefObject<boolean>;
  dispatchExecution: Dispatch<RayenSyncExecutionAction>;
  executionRef: RefObject<RayenSyncExecutionState>;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  clearSyncTimeout: () => void;
  syncRequestController: RayenSyncRequestController;
  preparedSyncContextRef: RefObject<PreparedRayenSyncContext | null>;
  startCaptureRequest: (prepared: PreparedRayenSyncContext, runId: string) => string;
  failRun: (
    reason: RayenSyncFailureReason,
    runId?: string,
    error?: unknown,
    captureCheck?: RayenCaptureFailureCheck
  ) => Promise<void>;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  previewSnapshot: (
    snapshot: RayenCensusSnapshot,
    bundle: RayenSyncBundle,
    runId: string,
    requestId: string
  ) => void;
}

/** Subscribes to Eloísa capture snapshots and errors, including one silent transient retry. */
export const useRayenImportCaptureSubscriptions = ({
  mountedRef,
  dispatchExecution,
  executionRef,
  setState,
  clearSyncTimeout,
  syncRequestController,
  preparedSyncContextRef,
  startCaptureRequest,
  failRun,
  recordRunPerformance,
  previewSnapshot,
}: UseRayenImportCaptureSubscriptionsInput): void => {
  const relayRetryRunRef = useRef<string | null>(null);

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
            errorTechnicalDetail: classified.technicalDetail
              ? { message: classified.message, detail: classified.technicalDetail }
              : null,
          }));
        }
      ),
    [
      clearSyncTimeout,
      dispatchExecution,
      executionRef,
      failRun,
      mountedRef,
      preparedSyncContextRef,
      recordRunPerformance,
      setState,
      startCaptureRequest,
      syncRequestController,
    ]
  );
};
