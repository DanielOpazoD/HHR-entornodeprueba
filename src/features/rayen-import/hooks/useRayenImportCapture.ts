import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { CensusSyncTarget } from '../domain/historicalCensusSync';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import * as rayenImportBridge from '../bridge/rayenImportBridge';
import type { RayenExtensionHealthState } from './useRayenExtensionHealth';
import { failureReasonFromHealth } from './useRayenSyncAudit';
import { resetRayenFillProgress } from './useRayenFillStatus';
import { resolveSyncReportRequest } from './reportDateHelpers';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import type { RayenSyncRequestController } from './rayenSyncRequestLifecycle';
import type { RayenSyncFailureReason, RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';

interface UseRayenImportCaptureInput {
  currentRecord: DailyRecord | null | undefined;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  setStaffingProposal: Dispatch<SetStateAction<NursingStaffingProposal | null>>;
  setStaffingProposalError: Dispatch<SetStateAction<string | null>>;
  clearSyncTimeout: () => void;
  syncRequestController: RayenSyncRequestController;
  syncTargetRef: MutableRefObject<CensusSyncTarget | null>;
  startRun: (
    health?: RayenExtensionHealthState,
    performance?: RayenSyncPerformanceDelta
  ) => RayenSyncRun;
  failRun: (reason: RayenSyncFailureReason, runId?: string) => Promise<void>;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  previewSnapshot: (snapshot: RayenCensusSnapshot, bundle: RayenSyncBundle, runId: string) => void;
}

/** Owns extension capture subscriptions and the preflight/request lifecycle for one import flow. */
export const useRayenImportCapture = ({
  currentRecord,
  setState,
  setStaffingProposal,
  setStaffingProposalError,
  clearSyncTimeout,
  syncRequestController,
  syncTargetRef,
  startRun,
  failRun,
  recordRunPerformance,
  previewSnapshot,
}: UseRayenImportCaptureInput) => {
  useEffect(
    () =>
      rayenImportBridge.subscribeToRayenSnapshots((snapshot, bundle, requestId) => {
        const runId = syncRequestController.getRunId(requestId);
        if (!runId) return;
        previewSnapshot(snapshot, bundle, runId);
      }),
    [previewSnapshot, syncRequestController]
  );

  useEffect(
    () =>
      rayenImportBridge.subscribeToRayenImportErrors((_error, requestId) => {
        const runId = syncRequestController.getRunId(requestId);
        if (!runId) return;
        clearSyncTimeout();
        syncTargetRef.current = null;
        void failRun('snapshot_error', runId);
        setState(previous => ({
          ...previous,
          isBusy: false,
          isSyncing: false,
          error:
            'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen e inténtalo nuevamente.',
        }));
      }),
    [clearSyncTimeout, failRun, setState, syncRequestController, syncTargetRef]
  );

  return useCallback(
    (health: RayenExtensionHealthState, performance?: RayenSyncPerformanceDelta) => {
      clearSyncTimeout();
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
      const run = startRun(health, performance);
      if (!health.canSync) {
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
      if (!currentRecord) {
        void failRun('snapshot_error', run.id);
        setState(previous => ({
          ...previous,
          isSyncing: false,
          result: null,
          hasSkippedItems: false,
          error: 'No hay un censo cargado para sincronizar.',
        }));
        return;
      }

      let syncRequest: ReturnType<typeof resolveSyncReportRequest>;
      try {
        syncRequest = resolveSyncReportRequest(currentRecord, new Date());
      } catch (error) {
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

      syncTargetRef.current = syncRequest.target;
      setState(previous => ({
        ...previous,
        isSyncing: true,
        result: null,
        hasSkippedItems: false,
        error: null,
      }));
      syncRequestController.start(
        syncRequest.range.dateStart,
        syncRequest.range.dateEnd,
        run.id,
        () => {
          syncTargetRef.current = null;
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
      recordRunPerformance({ counters: { requests: 1 } }, run.id);
    },
    [
      clearSyncTimeout,
      currentRecord,
      failRun,
      recordRunPerformance,
      setStaffingProposal,
      setStaffingProposalError,
      setState,
      startRun,
      syncRequestController,
      syncTargetRef,
    ]
  );
};
