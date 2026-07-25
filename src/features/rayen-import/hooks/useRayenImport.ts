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
import { applyCensusImportDiff, type ApplyResult } from '../domain/applyCensusImportDiff';
import {
  ensureFreshDailyRecordQuery,
  patchDailyRecordWithCompatibility,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { ClinicalFillPatchTarget } from '../clinicalFillRunner';
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
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { assertClinicalFillPatchTarget } from '../domain/clinicalFillPatchTarget';
import { applyHistoricalCudyr as applyHistoricalCudyrToRecord } from './applyHistoricalCudyr';
import { applyConfirmedRayenImport, hasSkippedPreviousDayCorrections } from './confirmRayenImport';
import { useRayenSnapshotPreview } from './useRayenSnapshotPreview';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { useNursesQuery } from '@/hooks/useStaffQuery';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import {
  invalidateRayenFillAttempt,
  isRayenFillAttemptCurrent,
  reportRayenStaffingOutcome,
  resetRayenFillProgress,
} from './useRayenFillStatus';
import { useRayenStaffingProposalActions } from './useRayenStaffingProposalActions';
import { nextIsoDay, toLiveSyncReportDate } from './reportDateHelpers';
import { createRayenSyncRequestController } from './rayenSyncRequestLifecycle';
const makeId = (): string => crypto.randomUUID();

export const useRayenImport = () => {
  const queryClient = useQueryClient();
  const { data: nursesList = [] } = useNursesQuery();
  const { mode } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  const { currentUser, role } = useAuthState();
  const { mutateAsync: saveDailyRecord } = useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  // Non-admin users can only correct previous days within Firestore's editing window.
  const isAdmin = role === 'admin';
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const [staffingProposal, setStaffingProposal] = useState<NursingStaffingProposal | null>(null);
  const [isStaffingProposalBusy, setIsStaffingProposalBusy] = useState(false);
  const [staffingProposalError, setStaffingProposalError] = useState<string | null>(null);
  const [syncRequestController] = useState(createRayenSyncRequestController);
  const clearSyncTimeout = useCallback(
    () => syncRequestController.cancel(),
    [syncRequestController]
  );
  useEffect(() => clearSyncTimeout, [clearSyncTimeout]);
  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;
  const currentRecordRef = useRef(currentRecord);
  currentRecordRef.current = currentRecord;
  const { mutateAsync: patchDailyRecord } = usePatchDailyRecordMutation(currentRecord?.date ?? '');
  const patchFreshClinicalRecord = useCallback(
    async (patch: DailyRecordPatch, target: ClinicalFillPatchTarget): Promise<void> => {
      const date = target.censusDate;
      const fresh = await dailyRecord.getForDateWithMeta(date, true);
      if (!fresh.record) throw new Error('No se pudo obtener la versión vigente del censo.');
      assertClinicalFillPatchTarget(fresh.record, target);
      const result = await patchDailyRecordWithCompatibility(dailyRecord, date, patch, {
        baseRecord: fresh.record,
      });
      if (result?.blockingError) throw result.blockingError;
      if (isDailyRecordWriteBlockedResult(result)) {
        throw new Error(result?.userSafeMessage || 'El guardado clínico fue bloqueado.');
      }
    },
    [dailyRecord]
  );
  const syncActor = currentUser?.displayName || currentUser?.email || 'Usuario sin nombre';
  const {
    startRun,
    ensureRun,
    applyRunToRecord,
    persistAppliedRun,
    completeRun,
    failRun,
    cancelRun,
  } = useRayenSyncAudit({ currentRecordRef, patchDailyRecord, actor: syncActor });
  const applyDiff = useCallback(
    async (record: DailyRecord, diff: CensusImportDiff): Promise<ApplyResult> => {
      const run = ensureRun();
      const result = applyCensusImportDiff(record, diff, {
        idFactory: makeId,
        actor: run.by,
        syncRunId: run.id,
      });
      const stamped = applyRunToRecord(result.record, diff).record;
      await saveDailyRecord(stamped);
      return { ...result, record: stamped };
    },
    [applyRunToRecord, ensureRun, saveDailyRecord]
  );
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
      const hasVacancies = proposal.day.names.length > 0 || proposal.night.names.length > 0;
      const hasAmbiguity = proposal.day.ambiguous || proposal.night.ambiguous;
      if (!canWritePreviousDay(proposal.censusDate, isAdmin)) {
        reportRayenStaffingOutcome(
          hasVacancies || hasAmbiguity ? 'declined' : 'resolved',
          attemptId
        );
        return;
      }
      reportRayenStaffingOutcome(
        hasVacancies ? 'pending' : hasAmbiguity ? 'ambiguous' : 'resolved',
        attemptId
      );
      // Only interrupt for a real decision; the pulse and audit retain all other evidence.
      setStaffingProposal(hasVacancies ? proposal : null);
    },
    [isAdmin]
  );
  const fillDevicesInBackground = useRayenClinicalFill({
    nurseCatalog: nursesList,
    patchDailyRecord: patchFreshClinicalRecord,
    applyHistoricalCudyr,
    completeRun,
    onStaffingProposal: presentStaffingProposal,
    onSettled: finishSyncing,
    createId: makeId,
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
  });
  useEffect(() => subscribeToRayenSnapshots(previewSnapshot), [previewSnapshot]);
  useEffect(
    () =>
      subscribeToRayenImportErrors(() => {
        clearSyncTimeout();
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
    (health: RayenExtensionHealthState) => {
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
      startRun(health);
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
      let reportDate: string;
      try {
        reportDate = toLiveSyncReportDate(currentRecord);
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
      setState(prev => ({
        ...prev,
        isSyncing: true,
        result: null,
        hasSkippedItems: false,
        error: null,
      }));
      syncRequestController.start(reportDate, nextIsoDay(reportDate), () => {
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
    },
    [clearSyncTimeout, currentRecord, failRun, startRun, syncRequestController]
  );

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
      // Apply against the ref so recent HHR changes cannot be lost to a stale closure.
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
          createId: makeId,
        });
        setState(prev => ({
          ...prev,
          isBusy: false,
          isPreviewOpen: diff.summary.conflicts > 0,
          result,
          hasSkippedItems: skippedPreviousDays || result.skipped.length > 0,
        }));
        // Keeps `isSyncing` on until the background fill settles it.
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
      queryClient,
    ]
  );

  const cancel = useCallback(() => {
    invalidateRayenFillAttempt();
    cancelRun();
    const staffingDecisionWasSkipped =
      !!staffingProposal &&
      (staffingProposal.day.names.length > 0 ||
        staffingProposal.night.names.length > 0 ||
        staffingProposal.day.ambiguous ||
        staffingProposal.night.ambiguous);
    if (staffingDecisionWasSkipped) reportRayenStaffingOutcome('declined');
    setStaffingProposal(null);
    setStaffingProposalError(null);
    setState(prev => ({ ...prev, isPreviewOpen: false, isSyncing: false }));
  }, [cancelRun, staffingProposal]);

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
      previewSnapshot,
      confirm,
      cancel,
      confirmStaffingProposal,
      dismissStaffingProposal,
    ]
  );
};
