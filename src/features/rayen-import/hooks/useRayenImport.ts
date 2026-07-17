/**
 * Orchestrates a Rayen census import in the UI: subscribe to snapshots (from the
 * extension bridge), plan the diff, then either open the preview (default) or apply
 * automatically (experimental mode). Applying persists via `useSaveDailyRecordMutation`.
 *
 * Safety rail: auto mode only auto-applies when the diff has no review-gated signals;
 * otherwise it falls back to the preview so a human can verify them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
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

const makeId = (): string => crypto.randomUUID();

export const useRayenImport = () => {
  const { mode } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  // currentUser → stamps who ran the sync (rayenSync.by); role → admin bypasses the editing window.
  const { currentUser, role } = useAuthState();
  // Destructure the stable `mutateAsync` reference: depending on the whole mutation
  // object would change identity each render, recreating applyDiff/previewSnapshot and
  // needlessly re-running the bridge subscription effect below on every render.
  const { mutateAsync: saveDailyRecord } = useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  // Admin bypasses the Firestore ~48h editing window (see firestore.rules isWithinEditingWindow); a
  // nurse can only write a previous day within that window — older days are surfaced but skipped.
  const isAdmin = role === 'admin';
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  // Fallback timer for the "sincronizando" indicator: if the extension never answers the snapshot
  // request, clear the spinner and surface a hint instead of spinning forever.
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSyncTimeout = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => clearSyncTimeout, [clearSyncTimeout]);

  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;
  // Always-fresh reference for the stale-save retry in `confirm` (the closure record can lag).
  const currentRecordRef = useRef(currentRecord);
  currentRecordRef.current = currentRecord;
  // Granular per-patient patches for the background fill — never a full-record save.
  const { mutateAsync: patchDailyRecord } = usePatchDailyRecordMutation(currentRecord?.date ?? '');
  const patchFreshClinicalRecord = useCallback(
    async (patch: DailyRecordPatch, target: ClinicalFillPatchTarget): Promise<void> => {
      const date = target.censusDate;
      // Each patient write starts from the latest repository record. The React query cache may
      // still hold the optimistic version from the previous patient and must not become the CAS
      // base for the next one in the same synchronization.
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
  const fillDevicesInBackground = useRayenClinicalFill({
    patchDailyRecord: patchFreshClinicalRecord,
    applyHistoricalCudyr,
    completeRun,
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

  // Trigger an import: show the spinner immediately, ask the extension for a snapshot, and guard with
  // a fallback timer so an uninstalled/asleep extension doesn't leave it spinning forever.
  const triggerImport = useCallback(
    (health?: RayenExtensionHealthState) => {
      clearSyncTimeout();
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
          getFreshRecord: () => currentRecordRef.current,
          createId: makeId,
        });
        setState(prev => ({ ...prev, isBusy: false, isPreviewOpen: false, result }));
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
    ]
  );

  const cancel = useCallback(() => {
    cancelRun();
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
      triggerImport,
      previewSnapshot,
      confirm,
      cancel,
    }),
    [mode, state, triggerImport, previewSnapshot, confirm, cancel]
  );
};
