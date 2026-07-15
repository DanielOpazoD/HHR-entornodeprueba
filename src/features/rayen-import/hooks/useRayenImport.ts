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
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { applyCensusImportDiff, type ApplyResult } from '../domain/applyCensusImportDiff';
import { requiresReview } from '../domain/reconcileCensus';
import { applyEgresoReport, markEgresoReportUnavailable } from '../domain/applyEgresoReport';
import { computePreviousDayEdits, fileCrossDayCorrections } from '../domain/previousDayCorrections';
import { toIsoReportDate, nextIsoDay } from './reportDateHelpers';
import {
  subscribeToRayenSnapshots,
  subscribeToRayenImportErrors,
  requestRayenSnapshot,
  requestEgresoReport,
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
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

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
  // Guards the experimental auto-apply path. The bridge can deliver snapshots
  // back-to-back; without this, a second auto-apply would start from the same base
  // record as the first (which has not finished saving) and silently clobber it.
  // `isBusy` is async React state, so it cannot close this window on its own.
  const autoApplyingRef = useRef(false);
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
  const fillDevicesInBackground = useRayenClinicalFill({
    patchDailyRecord,
    completeRun,
    onSettled: finishSyncing,
    createId: makeId,
  });

  const previewSnapshot = useCallback(
    async (snapshot: RayenCensusSnapshot) => {
      // The snapshot arrived — cancel the "no answer" fallback timer.
      clearSyncTimeout();
      if (!currentRecord) {
        // There is no daily record where an audit event could be persisted, but the
        // deliberate run still has to be closed so a later snapshot cannot reuse it.
        void failRun('apply_failed');
        setState(prev => ({
          ...prev,
          isSyncing: false,
          error: 'No hay censo cargado para hoy.',
        }));
        return;
      }
      let { diff } = planRayenCensusImport({ current: currentRecord, snapshot });

      // The bulk Gestión de Camas report is the only authority for statistical egresos. Ficha
      // Médico may signal a clinical closure, but it never vacates a bed by itself.
      const reportDate = toIsoReportDate(currentRecord);
      // Fetch the report for [D, D+1]: the source files a late island egreso on the NEXT day (its
      // filter runs in a zone ahead of Rapa Nui), so asking only for D would miss it. The extra day's
      // rows are routed to their real island day (or skipped) by the day-correction logic downstream.
      const reportResult = await requestEgresoReport(reportDate, nextIsoDay(reportDate));
      const reportAvailable = reportResult.ok;
      diff = reportAvailable
        ? applyEgresoReport(diff, reportResult.rows, currentRecord)
        : markEgresoReportUnavailable(diff);

      // Discharge-day corrections: egresos whose official island day is earlier than the census day
      // are filed on that previous day (behind confirmation), so they must never auto-apply. The plan
      // also drops egresos already consigned on their real day (RUT-verified), so the preview never
      // nags about an egreso that is already there.
      const previousDayPlan = await computePreviousDayEdits(dailyRecord, diff, reportDate, isAdmin);
      const previousDayEdits = previousDayPlan.edits;
      diff = { ...diff, reportEgresos: previousDayPlan.reportEgresos };
      if (previousDayEdits.length > 0) diff = { ...diff, previousDayEdits };

      const needsReview = requiresReview(diff) || previousDayEdits.length > 0;
      const canAutoApply = mode === 'auto' && !needsReview;

      if (canAutoApply) {
        if (autoApplyingRef.current) return;
        autoApplyingRef.current = true;
        setState({
          diff,
          isPreviewOpen: false,
          isBusy: true,
          isSyncing: true,
          result: null,
          error: null,
        });
        applyDiff(currentRecord, diff)
          .then(result => {
            autoApplyingRef.current = false;
            setState(prev => ({ ...prev, isBusy: false, result }));
            // Keeps `isSyncing` on until the background fill settles it.
            void fillDevicesInBackground(result.record);
          })
          .catch(error => {
            autoApplyingRef.current = false;
            void failRun('apply_failed');
            setState(prev => ({
              ...prev,
              isBusy: false,
              isSyncing: false,
              error: getRayenImportErrorMessage(error),
            }));
          });
        return;
      }

      // When the census has nothing to apply (all "sin cambios"), the Confirmar button is
      // disabled — but devices still need refreshing. Fill them on the current record in the
      // background so the disabled confirm doesn't block the device sync entirely.
      const hasApplicableChanges =
        diff.admissions.length +
          diff.updates.length +
          diff.moves.length +
          diff.discharges.length +
          (diff.reportEgresos?.length ?? 0) >
        0;
      // With census changes to confirm, syncing "pauses" for human review; with none, the fill runs
      // now and keeps the indicator on until it settles.
      if (!hasApplicableChanges && reportAvailable) {
        // Sin diff que aplicar: sella la sincronización (who+when) por patch; un fallo aquí solo
        // pierde ese sello (no datos clínicos), así que se loguea sin bloquear al usuario.
        try {
          const stamped = await persistAppliedRun(currentRecord, diff);
          void fillDevicesInBackground(stamped);
        } catch (err) {
          console.warn('[rayen-import] sello de sincronización no registrado:', err);
          void failRun('apply_failed');
          setState(prev => ({ ...prev, isSyncing: false }));
        }
      }

      setState({
        diff,
        isPreviewOpen: true,
        isBusy: false,
        isSyncing: !hasApplicableChanges && reportAvailable,
        result: null,
        error: !reportAvailable
          ? 'No fue posible verificar las altas administrativas en Gestión de Camas. Revisa esa pestaña y vuelve a sincronizar; el censo no se aplicará automáticamente.'
          : mode === 'auto' && needsReview
            ? 'El modo automático requiere revisión: hay conflictos, altas administrativas pendientes o correcciones de días previos.'
            : null,
      });
    },
    [
      currentRecord,
      mode,
      applyDiff,
      fillDevicesInBackground,
      clearSyncTimeout,
      dailyRecord,
      isAdmin,
      persistAppliedRun,
      failRun,
    ]
  );

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
        // File the corrected-earlier egresos on their REAL day FIRST (only when accepted). This write
        // is idempotent (deterministic ids merge on re-sync) and reads `base.beds`, which applyDiff
        // below is about to vacate. Filing first means a transient failure here leaves today untouched,
        // so the whole confirm() is safely retriable.
        if (applyPreviousDays) {
          const run = ensureRun();
          await fileCrossDayCorrections(
            dailyRecord,
            base,
            diff,
            toIsoReportDate(base),
            isAdmin,
            makeId,
            { actor: run.by, syncRunId: run.id }
          );
        }
        let result: ApplyResult;
        try {
          result = await applyDiff(base, diff);
        } catch (error) {
          // Freshness guard: the record changed under us (another tab, the background fill of a
          // previous run…). The guard already refreshed the cache — retry ONCE against the fresh
          // record instead of bouncing the error back to the user.
          if (!/actualizó hace un momento/i.test(getRayenImportErrorMessage(error))) throw error;
          await new Promise(resolve => setTimeout(resolve, 900));
          const fresh = currentRecordRef.current;
          if (!fresh) throw error;
          result = await applyDiff(fresh, diff);
        }
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
