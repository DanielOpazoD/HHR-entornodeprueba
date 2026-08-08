import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuthState } from '@/hooks/useAuthState';
import * as dailyRecordQuery from '@/hooks/useDailyRecordQuery';
import { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { useRayenImportMode } from './useRayenImportMode';
import {
  getRayenImportErrorMessage,
  INITIAL_RAYEN_IMPORT_STATE,
  type RayenImportState,
} from './rayenImportState';
import { useRayenSyncAudit } from './useRayenSyncAudit';
import { useRayenClinicalFill } from './useRayenClinicalFill';
import { useHistoricalCudyrPersistence } from './useHistoricalCudyrPersistence';
import { applyConfirmedRayenImport, hasSkippedPreviousDayCorrections } from './confirmRayenImport';
import { useRayenSnapshotPreview } from './useRayenSnapshotPreview';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import {
  invalidateRayenFillAttempt,
  reportRayenStaffingOutcome,
} from './useRayenFillStatus';
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
import { requestHistoryScales } from '../bridge/rayenImportBridge';
import { collectNursingStaffingProposal } from '../domain/collectNursingStaffingProposal';
import {
  hasNursingShiftReview,
  reconcileNursingShiftProposal,
} from '../domain/applyNursingShiftProposal';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import { isNursingStaffingCollectionContextCurrent } from '../domain/nursingStaffingCollectionContext';
export const useRayenImport = () => {
  const queryClient = useQueryClient();
  const { data: nursesList = [] } = useNursesQuery();
  const { data: tensList = [] } = useTensQuery();
  const { policy, mode, status: policyStatus } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  const { currentUser, role } = useAuthState();
  const { mutateAsync: saveDailyRecordMutation } = dailyRecordQuery.useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  const isAdmin = role === 'admin';
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const [staffingProposal, setStaffingProposal] = useState<NursingStaffingProposal | null>(null);
  const [isStaffingProposalBusy, setIsStaffingProposalBusy] = useState(false);
  const [staffingProposalError, setStaffingProposalError] = useState<string | null>(null);
  const { controller: syncRequestController, cancel: clearSyncTimeout } =
    useRayenSyncRequestController();
  const preparedSyncContextRef = useRef<PreparedRayenSyncContext | null>(null);
  const confirmationInFlightRef = useRef(false);
  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;
  const currentRecordRef = useRef(currentRecord);
  currentRecordRef.current = currentRecord;
  useEffect(() => {
    setStaffingProposal(null);
    setStaffingProposalError(null);
  }, [currentRecord?.date]);
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
  const {
    startRun,
    ensureRun,
    getRun,
    recordRunPerformance,
    applyRunToRecord,
    persistAppliedRun,
    completeRun,
    failRun,
    cancelRun,
  } = useRayenSyncAudit({
    currentRecordRef,
    patchDailyRecord,
    loadDailyRecord: loadFreshClinicalRecord,
    actor: syncActor,
  });
  const applyDiff = useRayenCensusDiffApplication({
    ensureRun,
    applyRunToRecord,
    saveDailyRecord: saveRayenCensus,
    recordRunPerformance,
  });
  const finishSyncing = useCallback(() => {
    setState(prev => (prev.isSyncing ? { ...prev, isSyncing: false } : prev));
  }, []);
  const { applyHistoricalCudyr, applyHistoricalCudyrBatch, applyHistoricalCudyrEnforcedBatch } =
    useHistoricalCudyrPersistence({
      dailyRecord,
      isAdmin,
    });
  const refreshStaffingProposal = useCallback(async (): Promise<NursingStaffingProposal | null> => {
    if (isStaffingProposalBusy) return null;
    setIsStaffingProposalBusy(true);
    setStaffingProposalError(null);
    try {
      const base = currentRecordRef.current ?? currentRecord;
      if (!base) throw new Error('No existe un censo abierto para revisar la dotación.');
      const freshRecord = await loadFreshClinicalRecord(base.date);
      const proposal = await collectNursingStaffingProposal(freshRecord, {
        fetchHistory: (encounterId, censusDate) =>
          requestHistoryScales(encounterId, censusDate, { lookbackDays: 2 }),
        nurseCatalog: nursesList,
        tensCatalog: tensList,
      });
      const latestRecord = await loadFreshClinicalRecord(freshRecord.date);
      if (
        !isNursingStaffingCollectionContextCurrent(
          freshRecord,
          latestRecord,
          currentRecordRef.current?.date
        )
      ) {
        throw new Error(
          'El censo cambió mientras se revisaba la dotación. Vuelve a intentarlo con la versión vigente.'
        );
      }
      const reconciled = reconcileNursingShiftProposal(freshRecord, {
        ...proposal,
        sourceLastUpdated: freshRecord.lastUpdated,
      });
      if (!canWritePreviousDay(reconciled.censusDate, isAdmin)) {
        setStaffingProposal(null);
        reportRayenStaffingOutcome(
          hasPendingStaffingDecision(reconciled) ? 'declined' : 'resolved'
        );
        return null;
      }
      const review = hasNursingShiftReview(reconciled) ? reconciled : null;
      setStaffingProposal(review);
      reportRayenStaffingOutcome(
        review && hasPendingStaffingDecision(review) ? 'pending' : 'resolved'
      );
      return review;
    } catch (error) {
      setStaffingProposalError(getRayenImportErrorMessage(error));
      return null;
    } finally {
      setIsStaffingProposalBusy(false);
    }
  }, [
    currentRecord,
    isAdmin,
    isStaffingProposalBusy,
    loadFreshClinicalRecord,
    nursesList,
    tensList,
  ]);
  const fillDevicesInBackground = useRayenClinicalFill({
    nurseCatalog: nursesList,
    tensCatalog: tensList,
    loadDailyRecord: loadFreshClinicalRecord,
    patchDailyRecord: patchClinicalRecord,
    applyHistoricalCudyr,
    applyHistoricalCudyrBatch,
    applyHistoricalCudyrEnforcedBatch,
    completeRun,
    // Staffing has its own explicit read/review action. Clinical synchronization must never leave
    // the main flow waiting for a roster decision.
    onStaffingProposal: () => undefined,
    onSettled: finishSyncing,
    createId: () => crypto.randomUUID(),
  });
  const previewSnapshot = useRayenSnapshotPreview({
    dailyRecord,
    isAdmin,
    setState,
    clearSyncTimeout,
    applyDiff,
    persistAppliedRun,
    fillDevicesInBackground,
    failRun,
    ensureRun,
    getRun,
    recordRunPerformance,
    preparedSyncContextRef,
  });
  const triggerImport = useRayenImportCapture({
    currentRecord,
    policy,
    policyStatus,
    setState,
    setStaffingProposal,
    setStaffingProposalError,
    clearSyncTimeout,
    syncRequestController,
    preparedSyncContextRef,
    loadFreshRecord: loadFreshClinicalRecord,
    startRun,
    failRun,
    recordRunPerformance,
    previewSnapshot,
  });
  const retryClinicalFill = useRayenClinicalFillRetry({
    currentRecord,
    currentRecordRef,
    fillClinicalData: fillDevicesInBackground,
    setState,
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
  const confirm = useCallback(
    async (applyPreviousDays: boolean = true) => {
      if (confirmationInFlightRef.current) return;
      const base = preparedSyncContextRef.current?.record ?? currentRecordRef.current ?? currentRecord;
      if (!base || !state.diff) return;
      confirmationInFlightRef.current = true;
      const diff = state.diff;
      const run = ensureRun();
      const skippedPreviousDays = hasSkippedPreviousDayCorrections(diff, applyPreviousDays);
      setState(prev => ({
        ...prev,
        isBusy: true,
        isSyncing: true,
        hasSkippedItems: false,
        error: null,
      }));
      try {
        const result = await applyConfirmedRayenImport({
          applyPreviousDays,
          base,
          diff,
          dailyRecord,
          isAdmin,
          ensureRun,
          applyDiff,
          // A retry after HTTP 409 must bypass the five-minute UI freshness cache. Otherwise each
          // bounded retry reuses the same obsolete revision and can never converge for X-1.
          getFreshRecord: () => loadFreshClinicalRecord(base.date),
          createId: () => crypto.randomUUID(),
          onRetry: () => recordRunPerformance({ counters: { retries: 1 } }),
        });
        setState(prev => ({
          ...prev,
          isBusy: false,
          isPreviewOpen: diff.summary.conflicts > 0,
          result,
          hasSkippedItems: skippedPreviousDays || result.skipped.length > 0,
        }));
        preparedSyncContextRef.current = null;
        void fillDevicesInBackground(result.confirmedHandoff);
      } catch (error) {
        void failRun('apply_failed', run.id);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          isPreviewOpen: true,
          error: getRayenImportErrorMessage(error),
        }));
      } finally {
        confirmationInFlightRef.current = false;
      }
    },
    [
      currentRecord,
      state.diff,
      applyDiff,
      fillDevicesInBackground,
      dailyRecord,
      isAdmin,
      ensureRun,
      failRun,
      recordRunPerformance,
      loadFreshClinicalRecord,
    ]
  );
  const cancel = useCallback(() => {
    preparedSyncContextRef.current = null;
    if (shouldPreservePostImportFlow(state.diff, state.result)) {
      setState(prev => ({ ...prev, isPreviewOpen: false }));
      return;
    }
    invalidateRayenFillAttempt();
    cancelRun();
    if (staffingProposal && hasPendingStaffingDecision(staffingProposal))
      reportRayenStaffingOutcome('declined');
    setStaffingProposal(null);
    setStaffingProposalError(null);
    setState(prev => ({ ...prev, isPreviewOpen: false, isSyncing: false }));
  }, [cancelRun, staffingProposal, state.diff, state.result]);
  return useMemo(
    () => ({
      mode,
      diff: state.diff,
      isPreviewOpen: state.isPreviewOpen,
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
