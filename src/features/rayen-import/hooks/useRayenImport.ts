import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuthState } from '@/hooks/useAuthState';
import * as dailyRecordQuery from '@/hooks/useDailyRecordQuery';
import { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { ensureFreshDailyRecordQuery } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
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
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import {
  invalidateRayenFillAttempt,
  isRayenFillAttemptCurrent,
  reportRayenStaffingOutcome,
} from './useRayenFillStatus';
import { useRayenStaffingProposalActions } from './useRayenStaffingProposalActions';
import type { CensusSyncTarget } from '../domain/historicalCensusSync';
import { useRayenSyncRequestController } from './useRayenSyncRequestController';
import { hasPendingStaffingDecision } from '../domain/applyNursingShiftProposal';
import { useRayenClinicalFillRetry } from './useRayenClinicalFillRetry';
import { patchFreshClinicalRecord } from './patchFreshClinicalRecord';
import type { ClinicalFillPatchTarget } from '../contracts/clinicalFillContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import { useRayenCensusDiffApplication } from './useRayenCensusDiffApplication';
import { shouldPreservePostImportFlow } from '../domain/rayenPreviewClosePolicy';
import { useRayenImportCapture } from './useRayenImportCapture';
export const useRayenImport = () => {
  const queryClient = useQueryClient();
  const { data: nursesList = [] } = useNursesQuery();
  const { data: tensList = [] } = useTensQuery();
  const { policy, mode, status: policyStatus } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  const { currentUser, role } = useAuthState();
  const { mutateAsync: saveDailyRecord } = dailyRecordQuery.useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  const isAdmin = role === 'admin';
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const [staffingProposal, setStaffingProposal] = useState<NursingStaffingProposal | null>(null);
  const [isStaffingProposalBusy, setIsStaffingProposalBusy] = useState(false);
  const [staffingProposalError, setStaffingProposalError] = useState<string | null>(null);
  const { controller: syncRequestController, cancel: clearSyncTimeout } =
    useRayenSyncRequestController();
  const syncTargetRef = useRef<CensusSyncTarget | null>(null);
  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;
  const currentRecordRef = useRef(currentRecord);
  currentRecordRef.current = currentRecord;
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
    saveDailyRecord,
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
  const presentStaffingProposal = useCallback(
    (proposal: NursingStaffingProposal, attemptId: number) => {
      if (!isRayenFillAttemptCurrent(attemptId)) return;
      const sections = [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight];
      const hasVacancies = sections.some(section => (section?.names.length ?? 0) > 0);
      const hasAmbiguity = sections.some(section => section?.ambiguous);
      const hasPendingDecision = hasPendingStaffingDecision(proposal);
      if (!canWritePreviousDay(proposal.censusDate, isAdmin)) {
        reportRayenStaffingOutcome(hasPendingDecision ? 'declined' : 'resolved', attemptId);
        return;
      }
      reportRayenStaffingOutcome(
        hasVacancies ? 'pending' : hasAmbiguity ? 'ambiguous' : 'resolved',
        attemptId
      );
      setStaffingProposal(hasPendingDecision ? proposal : null);
    },
    [isAdmin]
  );
  const fillDevicesInBackground = useRayenClinicalFill({
    nurseCatalog: nursesList,
    tensCatalog: tensList,
    loadDailyRecord: loadFreshClinicalRecord,
    patchDailyRecord: patchClinicalRecord,
    applyHistoricalCudyr,
    applyHistoricalCudyrBatch,
    applyHistoricalCudyrEnforcedBatch,
    completeRun,
    onStaffingProposal: presentStaffingProposal,
    onSettled: finishSyncing,
    createId: () => crypto.randomUUID(),
  });
  const previewSnapshot = useRayenSnapshotPreview({
    currentRecord,
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
    syncTargetRef,
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
    syncTargetRef,
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
      const base = currentRecordRef.current ?? currentRecord;
      if (!base || !state.diff) return;
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
          getFreshRecord: async () =>
            (
              await ensureFreshDailyRecordQuery(
                base.date,
                { dailyRecord, queryClient },
                'clinical_save'
              )
            ).record,
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
      queryClient,
    ]
  );
  const cancel = useCallback(() => {
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
