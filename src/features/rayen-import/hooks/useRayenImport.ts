import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuthState } from '@/hooks/useAuthState';
import {
  useSaveDailyRecordMutation,
  usePatchDailyRecordMutation,
} from '@/hooks/useDailyRecordQuery';
import { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import { ensureFreshDailyRecordQuery } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  subscribeToRayenSnapshots,
  subscribeToRayenImportErrors,
} from '../bridge/rayenImportBridge';
import { useRayenImportMode } from './useRayenImportMode';
import {
  getRayenImportErrorMessage,
  INITIAL_RAYEN_IMPORT_STATE,
  type RayenImportState,
} from './rayenImportState';
import { failureReasonFromHealth, useRayenSyncAudit } from './useRayenSyncAudit';
import type { RayenExtensionHealthState } from './useRayenExtensionHealth';
import { useRayenClinicalFill } from './useRayenClinicalFill';
import { applyHistoricalCudyr as applyHistoricalCudyrToRecord } from './applyHistoricalCudyr';
import { applyConfirmedRayenImport, hasSkippedPreviousDayCorrections } from './confirmRayenImport';
import { useRayenSnapshotPreview } from './useRayenSnapshotPreview';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import {
  invalidateRayenFillAttempt,
  isRayenFillAttemptCurrent,
  reportRayenStaffingOutcome,
  resetRayenFillProgress,
} from './useRayenFillStatus';
import { useRayenStaffingProposalActions } from './useRayenStaffingProposalActions';
import { resolveSyncReportRequest } from './reportDateHelpers';
import type { CensusSyncTarget } from '../domain/historicalCensusSync';
import { useRayenSyncRequestController } from './useRayenSyncRequestController';
import { hasPendingStaffingDecision } from '../domain/applyNursingShiftProposal';
import { useRayenClinicalFillRetry } from './useRayenClinicalFillRetry';
import { patchFreshClinicalRecord } from './patchFreshClinicalRecord';
import type { ClinicalFillPatchTarget } from '../contracts/clinicalFillContracts';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import { useRayenCensusDiffApplication } from './useRayenCensusDiffApplication';
import { shouldPreservePostImportFlow } from '../domain/rayenPreviewClosePolicy';
export const useRayenImport = () => {
  const queryClient = useQueryClient();
  const { data: nursesList = [] } = useNursesQuery();
  const { data: tensList = [] } = useTensQuery();
  const { mode } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  const { currentUser, role } = useAuthState();
  const { mutateAsync: saveDailyRecord } = useSaveDailyRecordMutation();
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
  const { mutateAsync: patchDailyRecord } = usePatchDailyRecordMutation(currentRecord?.date ?? '');
  const patchClinicalRecord = useCallback(
    (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) =>
      patchFreshClinicalRecord(dailyRecord, patch, target),
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
    recordRunPerformance,
    applyRunToRecord,
    persistAppliedRun,
    completeRun,
    failRun,
    cancelRun,
  } = useRayenSyncAudit({ currentRecordRef, patchDailyRecord, actor: syncActor });
  const applyDiff = useRayenCensusDiffApplication({
    ensureRun,
    applyRunToRecord,
    saveDailyRecord,
    recordRunPerformance,
  });
  const finishSyncing = useCallback(() => {
    setState(prev => (prev.isSyncing ? { ...prev, isSyncing: false } : prev));
  }, []);
  const applyHistoricalCudyr = useCallback(
    (clinicalEpisodeId: string, censusDay: string, cudyr: ImportedCudyr) =>
      applyHistoricalCudyrToRecord({
        dailyRecord,
        clinicalEpisodeId,
        censusDay,
        cudyr,
        isAdmin,
      }),
    [dailyRecord, isAdmin]
  );
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
    completeRun,
    onStaffingProposal: presentStaffingProposal,
    onSettled: finishSyncing,
    createId: () => crypto.randomUUID(),
  });
  const previewSnapshot = useRayenSnapshotPreview({
    currentRecord,
    mode,
    dailyRecord,
    isAdmin,
    setState,
    clearSyncTimeout,
    applyDiff,
    persistAppliedRun,
    fillDevicesInBackground,
    failRun,
    ensureRun,
    recordRunPerformance,
    syncTargetRef,
  });
  useEffect(() => subscribeToRayenSnapshots(previewSnapshot), [previewSnapshot]);
  useEffect(
    () =>
      subscribeToRayenImportErrors(() => {
        clearSyncTimeout();
        syncTargetRef.current = null;
        void failRun('snapshot_error');
        console.warn('[rayen-import] La extensión informó un error de lectura.');
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error:
            'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen e inténtalo nuevamente.',
        }));
      }),
    [clearSyncTimeout, failRun]
  );
  const triggerImport = useCallback(
    (health: RayenExtensionHealthState, performance?: RayenSyncPerformanceDelta) => {
      clearSyncTimeout();
      if (!resetRayenFillProgress()) {
        setState(prev => ({
          ...prev,
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
        void failRun(failureReasonFromHealth(health));
        setState(prev => ({
          ...prev,
          isSyncing: false,
          result: null,
          hasSkippedItems: false,
          error: null,
        }));
        return;
      }
      if (!currentRecord) {
        void failRun('snapshot_error');
        setState(prev => ({
          ...prev,
          isSyncing: false,
          result: null,
          hasSkippedItems: false,
          error: 'No hay un censo cargado para sincronizar.',
        }));
        return;
      }
      const requestedAt = new Date();
      let syncRequest: ReturnType<typeof resolveSyncReportRequest>;
      try {
        syncRequest = resolveSyncReportRequest(currentRecord, requestedAt);
      } catch (error) {
        void failRun('snapshot_error');
        setState(prev => ({
          ...prev,
          isSyncing: false,
          result: null,
          hasSkippedItems: false,
          error: getRayenImportErrorMessage(error),
        }));
        return;
      }
      syncTargetRef.current = syncRequest.target;
      setState(prev => ({
        ...prev,
        isSyncing: true,
        result: null,
        hasSkippedItems: false,
        error: null,
      }));
      syncRequestController.start(syncRequest.range.dateStart, syncRequest.range.dateEnd, () => {
        syncTargetRef.current = null;
        recordRunPerformance({ counters: { timeouts: 1 } }, run.id);
        void failRun('snapshot_timeout');
        setState(prev =>
          prev.isSyncing
            ? {
                ...prev,
                isSyncing: false,
                error:
                  'No se recibió respuesta de la extensión Rayen. Verifica que Ficha Médico y Gestión de Camas estén abiertas y conectadas.',
              }
            : prev
        );
      });
      recordRunPerformance({ counters: { requests: 1 } }, run.id);
    },
    [
      clearSyncTimeout,
      currentRecord,
      failRun,
      recordRunPerformance,
      startRun,
      syncRequestController,
    ]
  );

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
        void fillDevicesInBackground(result.record);
      } catch (error) {
        void failRun('apply_failed');
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
    const staffingDecisionWasSkipped =
      !!staffingProposal && hasPendingStaffingDecision(staffingProposal);
    if (staffingDecisionWasSkipped) reportRayenStaffingOutcome('declined');
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
