import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuthState } from '@/hooks/useAuthState';
import * as dailyRecordQuery from '@/hooks/useDailyRecordQuery';
import { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { useRayenImportMode } from './useRayenImportMode';
import { INITIAL_RAYEN_IMPORT_STATE, type RayenImportState } from './rayenImportState';
import { useRayenSyncAudit } from './useRayenSyncAudit';
import { useRayenClinicalFill } from './useRayenClinicalFill';
import { useHistoricalCudyrPersistence } from './useHistoricalCudyrPersistence';
import { useRayenSnapshotPreview } from './useRayenSnapshotPreview';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import { invalidateRayenFillAttempt, reportRayenStaffingOutcome } from './useRayenFillStatus';
import { useRayenStaffingProposalActions } from './useRayenStaffingProposalActions';
import { useRayenSyncRequestController } from './useRayenSyncRequestController';
import { hasPendingStaffingDecision } from '../domain/applyNursingShiftProposal';
import { useRayenClinicalFillRetry } from './useRayenClinicalFillRetry';
import { patchFreshClinicalRecord } from './patchFreshClinicalRecord';
import type { ClinicalFillPatchTarget } from '../contracts/clinicalFillContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import { useRayenCensusDiffApplication } from './useRayenCensusDiffApplication';
import { shouldPreservePostImportFlow } from '../domain/rayenPreviewClosePolicy';
import { useRayenImportCapture } from './useRayenImportCapture';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';
import { useRayenSyncExecutionController } from './useRayenSyncExecutionController';
import {
  isRayenSyncExecutionActive,
  isRayenSyncExecutionCancellableBeforeCommit,
} from './rayenSyncExecutionState';
import { createRayenSyncPersistenceQueue } from './rayenSyncPersistenceQueue';
import { useRayenImportConfirmation } from './useRayenImportConfirmation';
import type { RayenStructuralReplan } from './rayenStructuralConvergence';
import { useRayenStaffingProposalReview } from './useRayenStaffingProposalReview';
export const useRayenImport = (selectedCensusDate?: string) => {
  const queryClient = useQueryClient();
  const { data: nursesList = [] } = useNursesQuery();
  const { data: tensList = [] } = useTensQuery();
  const { policy, mode, status: policyStatus } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  const { currentUser, role } = useAuthState();
  const { mutateAsync: saveDailyRecordMutation } = dailyRecordQuery.useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  const isAdmin = role === 'admin';
  const [state, setStateFromReact] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const {
    execution,
    executionRef,
    keepsPreviewOpen,
    dispatchExecution,
    setImportStateCurrent: setState,
    transitionExecution,
    finishClinicalSync,
    startClinicalRetry,
  } = useRayenSyncExecutionController({
    importState: state,
    setImportState: setStateFromReact,
  });
  const { controller: syncRequestController, cancel: clearSyncTimeout } =
    useRayenSyncRequestController();
  const preparedSyncContextRef = useRef<PreparedRayenSyncContext | null>(null);
  const structuralReplanRef = useRef<RayenStructuralReplan | null>(null);
  const persistenceQueueRef = useRef(createRayenSyncPersistenceQueue());
  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;
  const currentRecordRef = useRef(currentRecord);
  useEffect(() => {
    currentRecordRef.current = currentRecord;
  }, [currentRecord]);
  const { mutateAsync: patchDailyRecord } = dailyRecordQuery.usePatchDailyRecordMutation(
    currentRecord?.date ?? ''
  );
  const patchClinicalRecord = useCallback(
    (
      patch: DailyRecordPatch,
      target: ClinicalFillPatchTarget,
      writeGuard: RayenClinicalWriteGuard
    ) => patchFreshClinicalRecord(dailyRecord, patch, target, writeGuard),
    [dailyRecord]
  );
  const loadFreshClinicalRecord = useCallback(
    async (date: string): Promise<DailyRecord> => {
      const result = await dailyRecord.getForDateWithMeta(date, true);
      if (!result.record) throw new Error('No se pudo obtener la versión vigente del censo.');
      return result.record as DailyRecord;
    },
    [dailyRecord]
  );
  const syncActor = currentUser?.displayName || currentUser?.email || 'Usuario sin nombre';
  const saveRayenCensus = useCallback(
    (record: DailyRecord, expectedLastUpdated: string) =>
      saveDailyRecordMutation({ record, expectedLastUpdated }),
    [saveDailyRecordMutation]
  );
  const runSerializedPersistence = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    return persistenceQueueRef.current.run(operation);
  }, []);
  const {
    startRun,
    ensureRun,
    getRun,
    recordRunPerformance,
    applyRunToRecord,
    completeRun,
    failRun,
    cancelRun,
  } = useRayenSyncAudit({
    currentRecordRef,
    patchDailyRecord,
    loadDailyRecord: loadFreshClinicalRecord,
    actor: syncActor,
  });
  const failRunSerialized = useCallback(
    (...args: Parameters<typeof failRun>) => runSerializedPersistence(() => failRun(...args)),
    [failRun, runSerializedPersistence]
  );
  const completeRunSerialized = useCallback(
    (...args: Parameters<typeof completeRun>) =>
      runSerializedPersistence(() => completeRun(...args)),
    [completeRun, runSerializedPersistence]
  );
  const selectedDate = selectedCensusDate ?? currentRecord?.date;
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    // The route selection changes before its record finishes loading. Cancel from that explicit
    // date instead of waiting for the replacement record, while same-date refetches remain inert.
    if (!selectedDate) return;
    const previousDate = selectedDateRef.current;
    selectedDateRef.current = selectedDate;
    if (!previousDate || previousDate === selectedDate) return;

    const stage = executionRef.current.stage;
    const cancellableBeforeCommit = isRayenSyncExecutionCancellableBeforeCommit(stage);
    if (isRayenSyncExecutionActive(stage) && !cancellableBeforeCommit) {
      // The structural handoff is already being persisted or clinical work is running. Changing
      // the route only dismisses its old-day view; the correlated execution must still converge.
      setState(previous => ({ ...previous, isPreviewOpen: false }));
      return;
    }

    clearSyncTimeout();
    preparedSyncContextRef.current = null;
    structuralReplanRef.current = null;
    dispatchExecution({ type: 'cancel' });
    dispatchExecution({ type: 'reset' });
    setState(INITIAL_RAYEN_IMPORT_STATE);
    if (cancellableBeforeCommit) cancelRun();
  }, [cancelRun, clearSyncTimeout, dispatchExecution, executionRef, selectedDate, setState]);
  const applyDiff = useRayenCensusDiffApplication({
    ensureRun,
    applyRunToRecord,
    saveDailyRecord: saveRayenCensus,
    recordRunPerformance,
  });
  const { applyHistoricalCudyr, applyHistoricalCudyrBatch, applyHistoricalCudyrEnforcedBatch } =
    useHistoricalCudyrPersistence({
      dailyRecord,
      isAdmin,
    });
  const {
    staffingProposal,
    setStaffingProposal,
    isStaffingProposalBusy,
    setIsStaffingProposalBusy,
    staffingProposalError,
    setStaffingProposalError,
    refreshStaffingProposal,
  } = useRayenStaffingProposalReview({
    currentRecord,
    currentRecordRef,
    isAdmin,
    nurseCatalog: nursesList,
    tensCatalog: tensList,
    loadFreshClinicalRecord,
  });
  const fillDevicesInBackground = useRayenClinicalFill({
    nurseCatalog: nursesList,
    tensCatalog: tensList,
    loadDailyRecord: loadFreshClinicalRecord,
    patchDailyRecord: patchClinicalRecord,
    applyHistoricalCudyr,
    applyHistoricalCudyrBatch,
    applyHistoricalCudyrEnforcedBatch,
    completeRun: completeRunSerialized,
    onStaffingProposal: () => undefined,
    onSettled: finishClinicalSync,
    createId: () => crypto.randomUUID(),
  });
  const previewSnapshot = useRayenSnapshotPreview({
    dailyRecord,
    isAdmin,
    setState,
    dispatchExecution,
    executionRef,
    selectedDateRef,
    clearSyncTimeout,
    applyDiff,
    fillDevicesInBackground,
    failRun: failRunSerialized,
    ensureRun,
    getRun,
    recordRunPerformance,
    preparedSyncContextRef,
    structuralReplanRef,
    runSerializedPersistence,
  });
  const triggerImport = useRayenImportCapture({
    currentRecord,
    selectedDate,
    policy,
    policyStatus,
    dispatchExecution,
    executionRef,
    setState,
    setStaffingProposal,
    setStaffingProposalError,
    clearSyncTimeout,
    syncRequestController,
    preparedSyncContextRef,
    loadFreshRecord: loadFreshClinicalRecord,
    startRun,
    failRun: failRunSerialized,
    cancelRun,
    recordRunPerformance,
    previewSnapshot,
  });
  const retryClinicalFill = useRayenClinicalFillRetry({
    currentRecord,
    currentRecordRef,
    fillClinicalData: fillDevicesInBackground,
    setState,
    onStart: record => {
      const runId = record.rayenSync?.runId;
      return runId ? startClinicalRetry(runId, record.date) : false;
    },
  });
  const { confirm: confirmStaffingProposal, dismiss: dismissStaffingProposal } =
    useRayenStaffingProposalActions({
      proposal: staffingProposal,
      setProposal: setStaffingProposal,
      isBusy: isStaffingProposalBusy,
      setIsBusy: setIsStaffingProposalBusy,
      setError: setStaffingProposalError,
      currentRecordRef,
      isAdmin,
      dailyRecord,
      queryClient,
    });
  const confirm = useRayenImportConfirmation({
    currentRecord,
    currentRecordRef,
    state,
    setState,
    executionRef,
    dispatchExecution,
    transitionExecution,
    preparedSyncContextRef,
    structuralReplanRef,
    selectedDateRef,
    dailyRecord,
    isAdmin,
    ensureRun,
    failRun: failRunSerialized,
    recordRunPerformance,
    applyDiff,
    fillDevicesInBackground,
    loadFreshClinicalRecord,
    runSerializedPersistence,
  });
  const cancel = useCallback(() => {
    const stage = executionRef.current.stage;
    const cancellableBeforeCommit = isRayenSyncExecutionCancellableBeforeCommit(stage);
    if (stage && !cancellableBeforeCommit) {
      // Closing the presentation cannot rewrite an already committed, terminal or post-commit
      // outcome as cancelled. Its truthful result remains available in the toolbar and history.
      setState(previous => ({ ...previous, isPreviewOpen: false }));
      return;
    }

    const runId = executionRef.current.context?.runId ?? executionRef.current.pending?.runId;
    if (cancellableBeforeCommit) {
      dispatchExecution({ type: 'cancel', runId });
      clearSyncTimeout();
      preparedSyncContextRef.current = null;
      structuralReplanRef.current = null;
    }
    if (!cancellableBeforeCommit && shouldPreservePostImportFlow(state.diff, state.result)) {
      setState(prev => ({ ...prev, isPreviewOpen: false }));
      return;
    }
    if (cancellableBeforeCommit) {
      invalidateRayenFillAttempt();
      cancelRun();
    }
    if (staffingProposal && hasPendingStaffingDecision(staffingProposal))
      reportRayenStaffingOutcome('declined');
    setStaffingProposal(null);
    setStaffingProposalError(null);
    setState(prev => ({ ...prev, isPreviewOpen: false, isSyncing: false }));
  }, [
    cancelRun,
    clearSyncTimeout,
    dispatchExecution,
    executionRef,
    setState,
    staffingProposal,
    state.diff,
    state.result,
  ]);
  return useMemo(
    () => ({
      mode,
      execution,
      diff: state.diff,
      isPreviewOpen: state.isPreviewOpen && keepsPreviewOpen,
      isBusy: state.isBusy,
      isSyncing: state.isSyncing,
      result: state.result,
      hasSkippedItems: state.hasSkippedItems,
      error: state.error,
      staffingProposal,
      isStaffingProposalBusy,
      staffingProposalError,
      refreshStaffingProposal,
      triggerImport,
      retryClinicalFill,
      previewSnapshot,
      confirm,
      cancel,
      confirmStaffingProposal,
      dismissStaffingProposal,
    }),
    [
      mode,
      execution,
      keepsPreviewOpen,
      state,
      staffingProposal,
      isStaffingProposalBusy,
      staffingProposalError,
      refreshStaffingProposal,
      triggerImport,
      retryClinicalFill,
      previewSnapshot,
      confirm,
      cancel,
      confirmStaffingProposal,
      dismissStaffingProposal,
    ]
  );
};
