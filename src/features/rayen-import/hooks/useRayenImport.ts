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
import { parseInvasiveDevices } from '../mapping/parseInvasiveDevices';
import { mapInvasiveDevices } from '../mapping/mapDeviceToInstance';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import {
  subscribeToRayenSnapshots,
  requestEgresoLookup,
  requestEgresoReport,
  requestDeviceReport,
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
  result: ApplyResult | null;
  error: string | null;
}

const INITIAL_STATE: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  isBusy: false,
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

  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;

  const applyDiff = useCallback(
    async (record: DailyRecord, diff: CensusImportDiff): Promise<ApplyResult> => {
      const result = applyCensusImportDiff(record, diff, { idFactory: makeId });
      await saveDailyRecord(result.record);
      return result;
    },
    [saveDailyRecord]
  );

  // Background device fill (Fase D): once the census is applied, fetch each synced patient's Ficha
  // Médico daily-summary PDF, parse its invasive-devices table (pdfjs) and merge the devices into
  // the patient — WITHOUT blocking the census. Best-effort per patient; saves once at the end so
  // the devices appear shortly after the beds. The gestión de camas / Ficha Médico tab must be open.
  // Patients are fetched in small concurrent batches (each PDF request can take seconds) and the
  // merges are folded back afterwards — every bed is independent of the others, so there is no race.
  const fillDevicesInBackground = useCallback(
    async (record: DailyRecord): Promise<void> => {
      const fecha = toIsoReportDate(record);
      const eligible = Object.entries(record.beds).filter(
        ([, patient]) => !!patient?.clinicalEpisodeId && !!patient.patientName?.trim()
      );

      const CONCURRENCY = 4;
      const merges: Array<{ bedId: string; patient: DailyRecord['beds'][string] }> = [];
      for (let start = 0; start < eligible.length; start += CONCURRENCY) {
        const batch = eligible.slice(start, start + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async ([bedId, patient]) => {
            if (!patient?.clinicalEpisodeId) return null;
            try {
              const { base64 } = await requestDeviceReport(patient.clinicalEpisodeId, fecha);
              if (!base64) return null;
              const items = await extractDeviceTextItems(base64);
              const devices = mapInvasiveDevices(parseInvasiveDevices(items));
              if (devices.length === 0) return null;
              return {
                bedId,
                patient: mergeReportDevices(patient, devices, {
                  now: new Date(),
                  createId: makeId,
                }),
              };
            } catch (error) {
              // Best-effort: skip this patient's devices on any failure (PDF/tab/parse), but log so a
              // silently-closed extension tab or a parse regression is diagnosable in production.
              console.warn(
                `[rayen-import] Relleno de dispositivos falló en cama ${bedId} (${patient.patientName}):`,
                error
              );
              return null;
            }
          })
        );
        for (const result of results) if (result) merges.push(result);
      }

      if (merges.length === 0) return;
      let updated = record;
      for (const { bedId, patient } of merges) {
        updated = { ...updated, beds: { ...updated.beds, [bedId]: patient } };
      }
      try {
        await saveDailyRecord(updated);
      } catch {
        // Devices are best-effort; the census is already saved.
      }
    },
    [saveDailyRecord]
  );

  const previewSnapshot = useCallback(
    async (snapshot: RayenCensusSnapshot) => {
      if (!currentRecord) {
        setState(prev => ({ ...prev, error: 'No hay censo cargado para hoy.' }));
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
        setState({ diff, isPreviewOpen: false, isBusy: true, result: null, error: null });
        applyDiff(currentRecord, diff)
          .then(result => {
            autoApplyingRef.current = false;
            setState(prev => ({ ...prev, isBusy: false, result }));
            void fillDevicesInBackground(result.record);
          })
          .catch(error => {
            autoApplyingRef.current = false;
            setState(prev => ({ ...prev, isBusy: false, error: errorMessage(error) }));
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
      if (!hasApplicableChanges) {
        void fillDevicesInBackground(currentRecord);
      }

      setState({
        diff,
        isPreviewOpen: true,
        isBusy: false,
        result: null,
        error:
          mode === 'auto' && needsReview
            ? 'El modo automático requiere revisión: hay conflictos o egresos inferidos por ausencia en Rayen.'
            : null,
      });
    },
    [currentRecord, mode, applyDiff, fillDevicesInBackground]
  );

  useEffect(() => subscribeToRayenSnapshots(previewSnapshot), [previewSnapshot]);

  const confirm = useCallback(async () => {
    if (!currentRecord || !state.diff) return;
    setState(prev => ({ ...prev, isBusy: true, error: null }));
    try {
      const result = await applyDiff(currentRecord, state.diff);
      setState(prev => ({ ...prev, isBusy: false, isPreviewOpen: false, result }));
      void fillDevicesInBackground(result.record);
    } catch (error) {
      setState(prev => ({ ...prev, isBusy: false, error: errorMessage(error) }));
    }
  }, [currentRecord, state.diff, applyDiff, fillDevicesInBackground]);

  const cancel = useCallback(() => {
    setState(prev => ({ ...prev, isPreviewOpen: false }));
  }, []);

  return useMemo(
    () => ({
      mode,
      diff: state.diff,
      isPreviewOpen: state.isPreviewOpen,
      isBusy: state.isBusy,
      result: state.result,
      error: state.error,
      previewSnapshot,
      confirm,
      cancel,
    }),
    [mode, state, previewSnapshot, confirm, cancel]
  );
};
