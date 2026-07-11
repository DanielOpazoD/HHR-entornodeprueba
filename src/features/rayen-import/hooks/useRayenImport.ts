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
import { useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { applyCensusImportDiff, type ApplyResult } from '../domain/applyCensusImportDiff';
import { requiresReview } from '../domain/reconcileCensus';
import { applyEgresoLookups, runsNeedingEgresoLookup } from '../domain/applyEgresoLookups';
import { applyEgresoReport, collectKnownRuns } from '../domain/applyEgresoReport';
import { mergeReportDevices } from '../domain/mergeReportDevices';
import { mergeReportScales } from '../domain/mergeReportScales';
import { parseInvasiveDevices } from '../mapping/parseInvasiveDevices';
import { mapInvasiveDevices } from '../mapping/mapDeviceToInstance';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import { parseEvaluationScales } from '../mapping/parseEvaluationScales';
import { buildImportedCudyr } from '@/domain/evaluationScales/importedCudyr';
import { setRayenFilling } from './useRayenFillStatus';
import {
  subscribeToRayenSnapshots,
  requestRayenSnapshot,
  requestEgresoLookup,
  requestEgresoReport,
  requestDeviceReport,
  requestScalesReport,
  requestCudyrCategories,
  type RayenCudyrCategory,
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

  const applyDiff = useCallback(
    async (record: DailyRecord, diff: CensusImportDiff): Promise<ApplyResult> => {
      const result = applyCensusImportDiff(record, diff, { idFactory: makeId });
      await saveDailyRecord(result.record);
      return result;
    },
    [saveDailyRecord]
  );

  // Background clinical fill (Fase D devices + Fase E scales): once the census is applied, fetch
  // each synced patient's Ficha Médico daily-summary PDF (invasive-devices table, parsed with
  // pdfjs) AND their evaluation-scale forms (Braden/Downton), merging both into the patient —
  // WITHOUT blocking the census. Each source is best-effort per patient (one failing never blocks
  // the other); saves once at the end so the data appears shortly after the beds. The Ficha Médico
  // tab must be open. Patients are fetched in small concurrent batches (each request can take
  // seconds) and the merges are folded back afterwards — every bed is independent, so no race.
  const fillDevicesInBackground = useCallback(
    async (record: DailyRecord): Promise<void> => {
      // Signal the DMI/Scores cells to show their loading animation while data is being fetched.
      setRayenFilling(true);
      // `fecha` is the CENSUS day (record's own day, never "today"), so a late sync of a past census
      // still asks Ficha Médico for that day's devices/scales/CUDYR — see toIsoReportDate.
      const fecha = toIsoReportDate(record);
      const eligible = Object.entries(record.beds).filter(
        ([, patient]) => !!patient?.clinicalEpisodeId && !!patient.patientName?.trim()
      );

      // Kick off the CUDYR bulk read in parallel — it MUST NOT block devices/scales. If the extension
      // is an older version without the CUDYR relay, this simply times out; meanwhile devices/scales
      // are fetched, merged and saved below, then CUDYR is folded in afterwards (second, later save).
      const cudyrPromise = requestCudyrCategories().catch((): { items: RayenCudyrCategory[] } => ({
        items: [],
      }));

      const CONCURRENCY = 4;
      const merges: Array<{ bedId: string; patient: DailyRecord['beds'][string] }> = [];
      for (let start = 0; start < eligible.length; start += CONCURRENCY) {
        const batch = eligible.slice(start, start + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async ([bedId, patient]) => {
            if (!patient?.clinicalEpisodeId) return null;
            let merged = patient;

            try {
              const { base64 } = await requestDeviceReport(patient.clinicalEpisodeId, fecha);
              if (base64) {
                const items = await extractDeviceTextItems(base64);
                const devices = mapInvasiveDevices(parseInvasiveDevices(items));
                if (devices.length > 0) {
                  merged = mergeReportDevices(merged, devices, {
                    now: new Date(),
                    createId: makeId,
                  });
                }
              }
            } catch (error) {
              // Best-effort: skip this patient's devices on any failure (PDF/tab/parse), but log so a
              // silently-closed extension tab or a parse regression is diagnosable in production.
              console.warn(
                `[rayen-import] Relleno de dispositivos falló en cama ${bedId} (${patient.patientName}):`,
                error
              );
            }

            try {
              const { forms } = await requestScalesReport(patient.clinicalEpisodeId);
              const scales = parseEvaluationScales(forms);
              if (scales.length > 0) {
                merged = mergeReportScales(merged, scales, { censusIsoDay: fecha });
              }
            } catch (error) {
              console.warn(
                `[rayen-import] Relleno de escalas falló en cama ${bedId} (${patient.patientName}):`,
                error
              );
            }

            return merged !== patient ? { bedId, patient: merged } : null;
          })
        );
        for (const result of results) if (result) merges.push(result);
      }

      // Save devices + scales first so they appear promptly, regardless of the CUDYR read.
      let updated = record;
      if (merges.length > 0) {
        for (const { bedId, patient } of merges) {
          updated = { ...updated, beds: { ...updated.beds, [bedId]: patient } };
        }
        try {
          await saveDailyRecord(updated);
        } catch {
          // Devices/scales are best-effort; the census is already saved.
        }
      }

      // Then fold in the CUDYR composite result for the census day (separate, later save so a slow or
      // absent CUDYR read never delays devices/scales). Rayen exposes only the aggregate (e.g. "D3").
      try {
        const { items } = await cudyrPromise;
        const cudyrByEnc = new Map(items.map(item => [item.encId, item]));
        let withCudyr = updated;
        let cudyrChanged = false;
        for (const [bedId, patient] of eligible) {
          if (!patient?.clinicalEpisodeId) continue;
          const row = cudyrByEnc.get(patient.clinicalEpisodeId);
          const importedCudyr = row ? buildImportedCudyr(row, fecha) : null;
          if (!importedCudyr) continue;
          const current = withCudyr.beds[bedId];
          withCudyr = {
            ...withCudyr,
            beds: {
              ...withCudyr.beds,
              [bedId]: {
                ...current,
                evaluationScores: { ...current.evaluationScores, cudyr: importedCudyr },
              },
            },
          };
          cudyrChanged = true;
        }
        if (cudyrChanged) await saveDailyRecord(withCudyr);
      } catch (error) {
        console.warn('[rayen-import] Relleno de CUDYR falló:', error);
      }

      // The background fill has settled — stop the "sincronizando" indicator and the cell animations.
      setRayenFilling(false);
      setState(prev => (prev.isSyncing ? { ...prev, isSyncing: false } : prev));
    },
    [saveDailyRecord]
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
      const reportRows = await requestEgresoReport(reportDate, reportDate);
      if (reportRows.length > 0) {
        diff = applyEgresoReport(diff, reportRows, collectKnownRuns(currentRecord, snapshot));
      }

      const needsReview = requiresReview(diff);
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
    [currentRecord, mode, applyDiff, fillDevicesInBackground, clearSyncTimeout]
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
    setState(prev => ({ ...prev, isBusy: true, isSyncing: true, error: null }));
    try {
      const result = await applyDiff(currentRecord, state.diff);
      setState(prev => ({ ...prev, isBusy: false, isPreviewOpen: false, result }));
      // Keeps `isSyncing` on until the background fill settles it.
      void fillDevicesInBackground(result.record);
    } catch (error) {
      setState(prev => ({ ...prev, isBusy: false, isSyncing: false, error: errorMessage(error) }));
    }
  }, [currentRecord, state.diff, applyDiff, fillDevicesInBackground]);

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
