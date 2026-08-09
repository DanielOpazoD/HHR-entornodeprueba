import { useCallback, useRef, type RefObject } from 'react';
import type { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { applyConfirmedRayenImport, hasSkippedPreviousDayCorrections } from './confirmRayenImport';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import {
  isRayenSyncExecutionCurrent,
  rayenSyncExecutionIdentity,
  rayenSyncExecutionKey,
  type RayenSyncExecutionAction,
} from './rayenSyncExecutionState';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';
import type { useRayenCensusDiffApplication } from './useRayenCensusDiffApplication';
import type { useRayenClinicalFill } from './useRayenClinicalFill';
import type { useRayenSyncAudit } from './useRayenSyncAudit';
import type { useRayenSyncExecutionController } from './useRayenSyncExecutionController';

type ExecutionController = ReturnType<typeof useRayenSyncExecutionController>;
type SyncAudit = ReturnType<typeof useRayenSyncAudit>;

interface UseRayenImportConfirmationInput {
  currentRecord: DailyRecord | null | undefined;
  currentRecordRef: RefObject<DailyRecord | null | undefined>;
  state: RayenImportState;
  setState: ExecutionController['setImportStateCurrent'];
  executionRef: ExecutionController['executionRef'];
  dispatchExecution: (action: RayenSyncExecutionAction) => void;
  transitionExecution: ExecutionController['transitionExecution'];
  preparedSyncContextRef: RefObject<PreparedRayenSyncContext | null>;
  selectedDateRef: RefObject<string | undefined>;
  dailyRecord: ReturnType<typeof useRepositories>['dailyRecord'];
  isAdmin: boolean;
  ensureRun: SyncAudit['ensureRun'];
  failRun: SyncAudit['failRun'];
  recordRunPerformance: SyncAudit['recordRunPerformance'];
  applyDiff: ReturnType<typeof useRayenCensusDiffApplication>;
  fillDevicesInBackground: ReturnType<typeof useRayenClinicalFill>;
  loadFreshClinicalRecord: (date: string) => Promise<DailyRecord>;
  runSerializedPersistence: <T>(operation: () => Promise<T>) => Promise<T>;
}

export const useRayenImportConfirmation = ({
  currentRecord,
  currentRecordRef,
  state,
  setState,
  executionRef,
  dispatchExecution,
  transitionExecution,
  preparedSyncContextRef,
  selectedDateRef,
  dailyRecord,
  isAdmin,
  ensureRun,
  failRun,
  recordRunPerformance,
  applyDiff,
  fillDevicesInBackground,
  loadFreshClinicalRecord,
  runSerializedPersistence,
}: UseRayenImportConfirmationInput) => {
  const confirmationExecutionKeysRef = useRef(new Set<string>());

  return useCallback(
    async (applyPreviousDays: boolean = true) => {
      const base =
        preparedSyncContextRef.current?.record ?? currentRecordRef.current ?? currentRecord;
      if (!base || !state.diff) return;
      const diff = state.diff;
      const run = ensureRun();
      const executionIdentity = rayenSyncExecutionIdentity(executionRef.current, run.id);
      if (
        !executionIdentity ||
        !isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)
      ) {
        return;
      }
      const confirmationKey = rayenSyncExecutionKey(executionIdentity);
      if (confirmationExecutionKeysRef.current.has(confirmationKey)) return;
      confirmationExecutionKeysRef.current.add(confirmationKey);
      transitionExecution({ type: 'persisting_structure' }, run.id);
      const skippedPreviousDays = hasSkippedPreviousDayCorrections(diff, applyPreviousDays);
      setState(previous => ({
        ...previous,
        isBusy: true,
        isSyncing: true,
        hasSkippedItems: false,
        error: null,
      }));
      try {
        const result = await runSerializedPersistence(() => {
          if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) {
            return Promise.resolve(null);
          }
          return applyConfirmedRayenImport({
            applyPreviousDays,
            base,
            diff,
            dailyRecord,
            isAdmin,
            ensureRun,
            applyDiff,
            getFreshRecord: () => loadFreshClinicalRecord(base.date),
            createId: () => crypto.randomUUID(),
            onRetry: () => recordRunPerformance({ counters: { retries: 1 } }),
          });
        });
        if (!result) return;
        const isCurrent = isRayenSyncExecutionCurrent(executionRef.current, executionIdentity);
        if (isCurrent) {
          dispatchExecution({
            type: 'record_outcome',
            ...executionIdentity,
            structuralConflicts: Math.max(diff.conflicts.length, diff.summary.conflicts),
            skippedItems:
              Number(skippedPreviousDays) + result.skipped.length,
          });
          const isExecutionDateVisible = selectedDateRef.current === executionIdentity.selectedDate;
          setState(previous => ({
            ...previous,
            isBusy: false,
            ...(isExecutionDateVisible
              ? {
                  isPreviewOpen: diff.summary.conflicts > 0,
                  result,
                  hasSkippedItems: skippedPreviousDays || result.skipped.length > 0,
                }
              : {}),
          }));
          transitionExecution({ type: 'verifying_structure' }, run.id);
          preparedSyncContextRef.current = null;
          transitionExecution({ type: 'syncing_clinical' }, run.id);
        }
        void fillDevicesInBackground(result.confirmedHandoff);
      } catch (error) {
        if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) return;
        transitionExecution({ type: 'failed' }, run.id);
        void failRun('apply_failed', run.id);
        const isExecutionDateVisible = selectedDateRef.current === executionIdentity.selectedDate;
        setState(previous => ({
          ...previous,
          isBusy: false,
          isSyncing: false,
          ...(isExecutionDateVisible
            ? {
                isPreviewOpen: true,
                error: getRayenImportErrorMessage(error),
              }
            : {}),
        }));
      } finally {
        confirmationExecutionKeysRef.current.delete(confirmationKey);
      }
    },
    [
      currentRecord,
      currentRecordRef,
      state.diff,
      applyDiff,
      fillDevicesInBackground,
      dailyRecord,
      isAdmin,
      ensureRun,
      executionRef,
      dispatchExecution,
      failRun,
      recordRunPerformance,
      loadFreshClinicalRecord,
      runSerializedPersistence,
      setState,
      transitionExecution,
      preparedSyncContextRef,
      selectedDateRef,
    ]
  );
};
