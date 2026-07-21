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
  requestRayenSnapshot,
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
import { applyConfirmedRayenImport } from './confirmRayenImport';
import { useRayenSnapshotPreview } from './useRayenSnapshotPreview';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { buildNursingShiftProposalPatch } from '../domain/applyNursingShiftProposal';
import { useNursesQuery } from '@/hooks/useStaffQuery';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import {
  isRayenFillAttemptCurrent,
  reportRayenStaffingOutcome,
  resetRayenFillProgress,
} from './useRayenFillStatus';

const makeId = (): string => crypto.randomUUID();

export const useRayenImport = () => {
  const queryClient = useQueryClient();
  const { data: nursesList = [] } = useNursesQuery();
  const { mode } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  // currentUser → stamps who ran the sync (rayenSync.by); role → admin bypasses the editing window.
  const { currentUser, role } = useAuthState();
  const { mutateAsync: saveDailyRecord } = useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  // Admin bypasses the Firestore ~48h editing window (see firestore.rules isWithinEditingWindow); a
  // nurse can only write a previous day within that window — older days are surfaced but skipped.
  const isAdmin = role === 'admin';
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const [staffingProposal, setStaffingProposal] = useState<NursingStaffingProposal | null>(null);
  const [isStaffingProposalBusy, setIsStaffingProposalBusy] = useState(false);
  const [staffingProposalError, setStaffingProposalError] = useState<string | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSyncTimeout = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);
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
      // Stamp the applied run + aggregate-only history atomically with the full census save.
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
      // Do not offer a write that Firestore will reject for a non-admin user.
      if (!canWritePreviousDay(proposal.censusDate, isAdmin)) {
        reportRayenStaffingOutcome('resolved', attemptId);
        return;
      }
      const hasVacancies = proposal.day.names.length > 0 || proposal.night.names.length > 0;
      const hasAmbiguity = proposal.day.ambiguous || proposal.night.ambiguous;
      reportRayenStaffingOutcome(
        hasVacancies ? 'pending' : hasAmbiguity ? 'ambiguous' : 'resolved',
        attemptId
      );
      setStaffingProposal(proposal);
      // Nursing belongs to the same reviewed sync journey. Reuse the preview instead of opening
      // a second modal after clinical enrichment settles (also covers experimental auto mode).
      setState(prev => ({ ...prev, isPreviewOpen: true }));
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
        // The extension payload may contain upstream details. Keep it out of the
        // persisted audit trail and out of the clinical UI; log only a category.
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
    (health?: RayenExtensionHealthState) => {
      clearSyncTimeout();
      resetRayenFillProgress();
      setStaffingProposal(null);
      setStaffingProposalError(null);
      startRun(health);
      if (health && !health.canSync) {
        void failRun(failureReasonFromHealth(health));
        setState(prev => ({ ...prev, isSyncing: false, result: null, error: null }));
        return;
      }
      setState(prev => ({ ...prev, isSyncing: true, result: null, error: null }));
      requestRayenSnapshot();
      syncTimeoutRef.current = setTimeout(() => {
        syncTimeoutRef.current = null;
        void failRun('snapshot_timeout');
        setState(prev =>
          prev.isSyncing
            ? {
                ...prev,
                isSyncing: false,
                error:
                  'No se recibió respuesta de la extensión Rayen. Verifica que esté instalada y con la pestaña de Ficha Médico abierta.',
              }
            : prev
        );
      }, 18000);
    },
    [clearSyncTimeout, failRun, startRun]
  );

  const dismissStaffingProposal = useCallback(() => {
    if (isStaffingProposalBusy) return;
    reportRayenStaffingOutcome('resolved');
    setStaffingProposal(null);
    setStaffingProposalError(null);
  }, [isStaffingProposalBusy]);

  const confirmStaffingProposal = useCallback(async () => {
    if (!staffingProposal) return;
    reportRayenStaffingOutcome('applying');
    setIsStaffingProposalBusy(true);
    setStaffingProposalError(null);
    try {
      if (currentRecordRef.current?.date !== staffingProposal.censusDate) {
        throw new Error(
          'La propuesta corresponde a otra fecha del censo. Vuelve a sincronizar el día actual.'
        );
      }
      if (!canWritePreviousDay(staffingProposal.censusDate, isAdmin)) {
        throw new Error(
          'Este censo está fuera de la ventana de edición. Solicita la actualización a un administrador.'
        );
      }
      const fresh = await ensureFreshDailyRecordQuery(
        staffingProposal.censusDate,
        { dailyRecord, queryClient },
        'clinical_patch'
      );
      if (!fresh.record) throw new Error('No se pudo obtener la versión vigente del censo.');
      const patch = buildNursingShiftProposalPatch(fresh.record, staffingProposal);
      if (!patch) {
        throw new Error(
          'La dotación de enfermería ya está sincronizada o cambió mientras revisabas la propuesta. Revisa la asignación actual.'
        );
      }
      const result = await patchDailyRecordWithCompatibility(
        dailyRecord,
        staffingProposal.censusDate,
        patch,
        { baseRecord: fresh.record }
      );
      if (result?.blockingError) throw result.blockingError;
      if (isDailyRecordWriteBlockedResult(result)) {
        throw new Error(result?.userSafeMessage || 'El guardado fue bloqueado.');
      }
      await ensureFreshDailyRecordQuery(
        staffingProposal.censusDate,
        { dailyRecord, queryClient },
        'clinical_patch'
      );
      setStaffingProposal(null);
      reportRayenStaffingOutcome('resolved');
    } catch (error) {
      reportRayenStaffingOutcome('pending');
      setStaffingProposalError(getRayenImportErrorMessage(error));
    } finally {
      setIsStaffingProposalBusy(false);
    }
  }, [dailyRecord, isAdmin, queryClient, staffingProposal]);

  // `applyPreviousDays` (default true) gates ONLY the cross-day corrections. Today's census changes
  // (admissions, moves, discharges) ALWAYS apply — the previous-day acknowledgment must never block
  // them (a bed move shouldn't wait on accepting an unrelated past-day egreso).
  const confirm = useCallback(
    async (applyPreviousDays: boolean = true) => {
      // ALWAYS apply against the freshest record (the ref), not the closure: a bed move the user just
      // did in HHR may not be in the closure's `currentRecord` yet, which would make the move's source
      // bed look empty and silently skip the move. The ref reflects the latest saved record.
      const base = currentRecordRef.current ?? currentRecord;
      if (!base || !state.diff) return;
      const diff = state.diff;
      setState(prev => ({ ...prev, isBusy: true, isSyncing: true, error: null }));
      try {
        const result = await applyConfirmedRayenImport({
          applyPreviousDays,
          base,
          diff,
          dailyRecord,
          isAdmin,
          ensureRun,
          applyDiff,
          // Refresh through the same QueryClient path used by the save guard. A repository-only
          // read leaves React Query stale, causing the retry to reject until a full page reload.
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
        setState(prev => ({ ...prev, isBusy: false, isPreviewOpen: true, result }));
        // Keeps `isSyncing` on until the background fill settles it.
        void fillDevicesInBackground(result.record);
      } catch (error) {
        void failRun('apply_failed');
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
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
    cancelRun();
    reportRayenStaffingOutcome('resolved');
    setStaffingProposal(null);
    setStaffingProposalError(null);
    setState(prev => ({ ...prev, isPreviewOpen: false, isSyncing: false }));
  }, [cancelRun]);

  return useMemo(
    () => ({
      mode,
      diff: state.diff,
      isPreviewOpen: state.isPreviewOpen,
      isBusy: state.isBusy,
      isSyncing: state.isSyncing,
      result: state.result,
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
