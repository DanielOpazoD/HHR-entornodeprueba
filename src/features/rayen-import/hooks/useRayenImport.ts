/**
 * Orchestrates a Rayen census import in the UI: subscribe to snapshots (from the
 * extension bridge), plan the diff, then either open the preview (default) or apply
 * automatically (experimental mode). Applying persists via `useSaveDailyRecordMutation`.
 *
 * Safety rail: auto mode only auto-applies when the diff has NO conflicts; otherwise
 * it falls back to the preview so a human resolves them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
  useSaveDailyRecordMutation,
  usePatchDailyRecordMutation,
} from '@/hooks/useDailyRecordQuery';
import { useRepositories } from '@/services/RepositoryContext';
import { useAuthState } from '@/hooks/useAuthState';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { applyCensusImportDiff, type ApplyResult } from '../domain/applyCensusImportDiff';
import { requiresReview } from '../domain/reconcileCensus';
import { applyEgresoLookups, runsNeedingEgresoLookup } from '../domain/applyEgresoLookups';
import { applyEgresoReport, collectKnownRuns } from '../domain/applyEgresoReport';
import { computePreviousDayEdits, fileCrossDayCorrections } from '../domain/previousDayCorrections';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import { runClinicalFill } from '../clinicalFillRunner';
import { beginRayenFill, reportRayenFillProgress, endRayenFill } from './useRayenFillStatus';
import {
  subscribeToRayenSnapshots,
  requestRayenSnapshot,
  requestEgresoLookup,
  requestEgresoReport,
  requestDeviceReport,
  requestHistoryScales,
  requestScalesReport,
  requestCudyrCategories,
} from '../bridge/rayenImportBridge';
import { useRayenImportMode } from './useRayenImportMode';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

const makeId = (): string => crypto.randomUUID();

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The record's date as ISO YYYY-MM-DD for the egreso report range (accepts ISO or DD/MM/YYYY). */
const toIsoReportDate = (record: DailyRecord): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  // Format in LOCAL time: toISOString() shifts to UTC, which in Rapa Nui (UTC-6/-5) would ask
  // the report for the wrong day from ~18:00 local onward.
  const fromDate = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Canonical source: the record's OWN day (its local-midnight timestamp), never "today". This
  // is what makes a late sync of a PAST census still ask the report for that census day.
  if (typeof record.dateTimestamp === 'number' && !Number.isNaN(record.dateTimestamp)) {
    return fromDate(new Date(record.dateTimestamp));
  }
  const raw = (record.date ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return fromDate(new Date());
};

/** The ISO day after `iso` (YYYY-MM-DD), computed in UTC to avoid host-tz drift. */
const nextIsoDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

interface RayenImportState {
  diff: CensusImportDiff | null;
  isPreviewOpen: boolean;
  isBusy: boolean;
  /** True from clicking Import until the whole flow settles (snapshot → plan → background fill). */
  isSyncing: boolean;
  result: ApplyResult | null;
  error: string | null;
}

const INITIAL_STATE: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  isBusy: false,
  isSyncing: false,
  result: null,
  error: null,
};

export const useRayenImport = () => {
  const { mode } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  // Destructure the stable `mutateAsync` reference: depending on the whole mutation
  // object would change identity each render, recreating applyDiff/previewSnapshot and
  // needlessly re-running the bridge subscription effect below on every render.
  const { mutateAsync: saveDailyRecord } = useSaveDailyRecordMutation();
  const { dailyRecord } = useRepositories();
  const { role } = useAuthState();
  // Admin bypasses the Firestore ~48h editing window (see firestore.rules isWithinEditingWindow); a
  // nurse can only write a previous day within that window — older days are surfaced but skipped.
  const isAdmin = role === 'admin';
  const [state, setState] = useState<RayenImportState>(INITIAL_STATE);
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

  const applyDiff = useCallback(
    async (record: DailyRecord, diff: CensusImportDiff): Promise<ApplyResult> => {
      const result = applyCensusImportDiff(record, diff, { idFactory: makeId });
      await saveDailyRecord(result.record);
      return result;
    },
    [saveDailyRecord]
  );

  // Background clinical fill (devices + scales + CUDYR), delegated to `runClinicalFill` — an
  // independent, port-injected, unit-tested runner. Results are applied as GRANULAR PER-PATIENT
  // PATCHES (beds.{bedId}.devices / evaluationScores / …) instead of full-record saves, so:
  //  - the fill can never clobber (or be blocked by) a concurrent census confirmation — the
  //    freshness guard "El censo se actualizó hace un momento" — and
  //  - each patient's data appears progressively as soon as it arrives.
  // Single-flight via beginRayenFill; progress + completion summary go to the fill-status store so
  // the button area and the DMI/Scores cells can show what is happening.
  const fillDevicesInBackground = useCallback(
    async (record: DailyRecord): Promise<void> => {
      // `fecha` is the CENSUS day (record's own day, never "today"), so a late sync of a past census
      // still asks Ficha Médico for that day's devices/scales/CUDYR — see toIsoReportDate.
      const fecha = toIsoReportDate(record);
      const eligibleCount = Object.values(record.beds).filter(
        patient => !!patient?.clinicalEpisodeId && !!patient.patientName?.trim()
      ).length;

      if (!beginRayenFill(eligibleCount)) return; // a fill is already running — single flight
      try {
        const summary = await runClinicalFill(
          record,
          fecha,
          {
            fetchDeviceReport: requestDeviceReport,
            extractDeviceItems: extractDeviceTextItems,
            fetchHistoryScales: requestHistoryScales,
            fetchScalesForms: requestScalesReport,
            fetchCudyrCategories: () => requestCudyrCategories(15000),
            applyPatch: async patch => {
              await patchDailyRecord(patch);
            },
            now: () => new Date(),
            createId: makeId,
          },
          ({ done, total }) => reportRayenFillProgress(done, total)
        );
        if (summary.errors.length > 0) {
          console.warn('[rayen-import] Relleno clínico con errores:', summary.errors);
        }
        endRayenFill(new Set(summary.errors.map(item => item.bedId)).size);
      } catch (error) {
        // The runner collects per-patient errors itself; this only guards truly unexpected failures.
        console.warn('[rayen-import] Relleno clínico falló:', error);
        endRayenFill(0);
      }

      // The background fill has settled — stop the "sincronizando" indicator.
      setState(prev => (prev.isSyncing ? { ...prev, isSyncing: false } : prev));
    },
    [patchDailyRecord]
  );

  const previewSnapshot = useCallback(
    async (snapshot: RayenCensusSnapshot) => {
      // The snapshot arrived — cancel the "no answer" fallback timer.
      clearSyncTimeout();
      if (!currentRecord) {
        setState(prev => ({
          ...prev,
          isSyncing: false,
          error: 'No hay censo cargado para hoy.',
        }));
        return;
      }
      let { diff } = planRayenCensusImport({ current: currentRecord, snapshot });

      // Late-sync gap: patients absent from Ficha Médico are inferred discharges. Ask gestión
      // de camas (by RUN) for their real egreso and upgrade them to confirmed discharges with
      // the right kind (alta/traslado). Degrades gracefully to [] if that tab isn't available.
      const runs = runsNeedingEgresoLookup(diff);
      if (runs.length > 0) {
        diff = applyEgresoLookups(diff, await requestEgresoLookup(runs));
      }

      // Bulk egreso report (Fase C): enumerate the day's egresos in gestión de camas. Confirms
      // the destination (domicilio/traslado) of known discharges AND surfaces egresos HHR never
      // synced (unknown RUN) for review. Degrades to [] if the report/tab is unavailable.
      const reportDate = toIsoReportDate(currentRecord);
      // Fetch the report for [D, D+1]: the source files a late island egreso on the NEXT day (its
      // filter runs in a zone ahead of Rapa Nui), so asking only for D would miss it. The extra day's
      // rows are routed to their real island day (or skipped) by the day-correction logic downstream.
      const reportRows = await requestEgresoReport(reportDate, nextIsoDay(reportDate));
      if (reportRows.length > 0) {
        diff = applyEgresoReport(diff, reportRows, collectKnownRuns(currentRecord, snapshot));
      }

      // Discharge-day corrections: egresos whose official island day is earlier than the census day
      // are filed on that previous day (behind confirmation), so they must never auto-apply.
      const previousDayEdits = await computePreviousDayEdits(
        dailyRecord,
        diff,
        reportDate,
        isAdmin
      );
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
            setState(prev => ({
              ...prev,
              isBusy: false,
              isSyncing: false,
              error: errorMessage(error),
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
      if (!hasApplicableChanges) {
        void fillDevicesInBackground(currentRecord);
      }

      setState({
        diff,
        isPreviewOpen: true,
        isBusy: false,
        isSyncing: !hasApplicableChanges,
        result: null,
        error:
          mode === 'auto' && needsReview
            ? 'El modo automático requiere revisión: hay conflictos o egresos inferidos por ausencia en Rayen.'
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
    ]
  );

  useEffect(() => subscribeToRayenSnapshots(previewSnapshot), [previewSnapshot]);

  // Trigger an import: show the spinner immediately, ask the extension for a snapshot, and guard with
  // a fallback timer so an uninstalled/asleep extension doesn't leave it spinning forever.
  const triggerImport = useCallback(() => {
    clearSyncTimeout();
    setState(prev => ({ ...prev, isSyncing: true, result: null, error: null }));
    requestRayenSnapshot();
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
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
  }, [clearSyncTimeout]);

  const confirm = useCallback(async () => {
    if (!currentRecord || !state.diff) return;
    const diff = state.diff;
    setState(prev => ({ ...prev, isBusy: true, isSyncing: true, error: null }));
    try {
      let result: ApplyResult;
      try {
        result = await applyDiff(currentRecord, diff);
      } catch (error) {
        // Freshness guard: the record changed under us (another tab, the background fill of a
        // previous run…). The guard already refreshed the cache — retry ONCE against the fresh
        // record instead of bouncing the error back to the user.
        if (!/actualizó hace un momento/i.test(errorMessage(error))) throw error;
        await new Promise(resolve => setTimeout(resolve, 900));
        const fresh = currentRecordRef.current;
        if (!fresh) throw error;
        result = await applyDiff(fresh, diff);
      }
      // Now that today is saved (beds vacated), file the corrected-earlier egresos on their real day.
      await fileCrossDayCorrections(
        dailyRecord,
        currentRecord,
        diff,
        toIsoReportDate(currentRecord),
        isAdmin,
        makeId
      );
      setState(prev => ({ ...prev, isBusy: false, isPreviewOpen: false, result }));
      // Keeps `isSyncing` on until the background fill settles it.
      void fillDevicesInBackground(result.record);
    } catch (error) {
      setState(prev => ({ ...prev, isBusy: false, isSyncing: false, error: errorMessage(error) }));
    }
  }, [currentRecord, state.diff, applyDiff, fillDevicesInBackground, dailyRecord, isAdmin]);

  const cancel = useCallback(() => {
    setState(prev => ({ ...prev, isPreviewOpen: false, isSyncing: false }));
  }, []);

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
