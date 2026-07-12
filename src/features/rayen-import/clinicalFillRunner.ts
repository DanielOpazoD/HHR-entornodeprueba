/**
 * Orchestrates the Rayen clinical fill (invasive devices + evaluation scales + CUDYR) as an
 * INDEPENDENT, testable unit. All IO goes through injected ports, and results are applied as
 * GRANULAR PER-PATIENT PATCHES (`beds.{bedId}.devices`, `beds.{bedId}.evaluationScores`, …) instead
 * of full-record saves — so the fill can never clobber (or be blocked by) a concurrent census
 * confirm, and each patient's data appears as soon as it arrives.
 *
 * Independence guarantees:
 * - Each SOURCE (devices / scales / CUDYR) is best-effort per patient; one failing never blocks
 *   the others. Failures are collected into the summary, not thrown.
 * - Each PATIENT is independent: their patch is applied as soon as their data is ready; a failure
 *   in one bed never blocks another.
 * - The CUDYR bulk read runs in parallel and is awaited per patient with everything else — an
 *   extension without the CUDYR relay only costs its own timeout, not the fill.
 *
 * `fecha` (the census day, Rapa Nui local) drives every source, so a late sync of a PAST census
 * fills that day's data.
 */

import type { DailyRecord, PatientData } from './contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { mergeReportDevices } from './domain/mergeReportDevices';
import { mergeReportScales } from './domain/mergeReportScales';
import { parseInvasiveDevices, type DeviceTextItem } from './mapping/parseInvasiveDevices';
import { mapInvasiveDevices } from './mapping/mapDeviceToInstance';
import { parseHistoryScales } from './mapping/parseHistoryScales';
import { buildImportedCudyr } from '@/domain/evaluationScales/importedCudyr';
import type { RayenCudyrCategory, RayenHistoryScaleEvent } from './bridge/rayenImportBridge';

export interface ClinicalFillDeps {
  fetchDeviceReport: (encId: string, fecha: string) => Promise<{ base64: string; error?: string }>;
  extractDeviceItems: (base64: string) => Promise<DeviceTextItem[]>;
  /**
   * Read one patient's risk scales as clinical-history events (real `publishDatetime` per event), so
   * `parseHistoryScales` can pick the last score applied on the census day — see `parseHistoryScales`.
   */
  fetchHistoryScales: (
    encId: string
  ) => Promise<{ events: RayenHistoryScaleEvent[]; error?: string }>;
  fetchCudyrCategories: () => Promise<{ items: RayenCudyrCategory[]; error?: string }>;
  /** Apply one patient's granular patch. Throwing marks that patient as failed, nothing else. */
  applyPatch: (patch: DailyRecordPatch) => Promise<void>;
  now: () => Date;
  createId: () => string;
}

export interface ClinicalFillError {
  bedId: string;
  source: 'devices' | 'scales' | 'cudyr' | 'patch';
  message: string;
}

export interface ClinicalFillSummary {
  /** Eligible patients (with clinicalEpisodeId + name). */
  total: number;
  /** Patients whose patch was applied (had at least one change). */
  patched: number;
  errors: ClinicalFillError[];
}

export interface ClinicalFillProgress {
  done: number;
  total: number;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** How many patients are fetched concurrently (each fetch can take seconds). */
const CONCURRENCY = 4;

export const runClinicalFill = async (
  record: DailyRecord,
  fecha: string,
  deps: ClinicalFillDeps,
  onProgress?: (progress: ClinicalFillProgress) => void
): Promise<ClinicalFillSummary> => {
  const eligible = Object.entries(record.beds).filter(
    ([, patient]) => !!patient?.clinicalEpisodeId && !!patient.patientName?.trim()
  );
  const summary: ClinicalFillSummary = { total: eligible.length, patched: 0, errors: [] };
  if (eligible.length === 0) return summary;

  // One bulk CUDYR read shared by every patient; a failure/timeout costs only this source. `ok`
  // marks the read as authoritative — only then may a stale stored category be removed.
  const cudyrPromise: Promise<{ map: Map<string, RayenCudyrCategory>; ok: boolean }> = deps
    .fetchCudyrCategories()
    .then(({ items }) => ({ map: new Map(items.map(item => [item.encId, item])), ok: true }))
    .catch(error => {
      summary.errors.push({ bedId: '*', source: 'cudyr', message: message(error) });
      return { map: new Map<string, RayenCudyrCategory>(), ok: false };
    });

  let done = 0;
  const report = (): void => {
    done += 1;
    onProgress?.({ done, total: eligible.length });
  };

  const fillPatient = async (bedId: string, patient: PatientData): Promise<void> => {
    const encId = patient.clinicalEpisodeId;
    if (!encId) return;
    let merged = patient;

    try {
      const { base64 } = await deps.fetchDeviceReport(encId, fecha);
      if (base64) {
        const items = await deps.extractDeviceItems(base64);
        const devices = mapInvasiveDevices(parseInvasiveDevices(items));
        if (devices.length > 0) {
          merged = mergeReportDevices(merged, devices, {
            now: deps.now(),
            createId: deps.createId,
          });
        }
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'devices', message: message(error) });
    }

    try {
      const { events } = await deps.fetchHistoryScales(encId);
      const scales = parseHistoryScales(events);
      if (scales.length > 0) {
        merged = mergeReportScales(merged, scales, { censusIsoDay: fecha });
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'scales', message: message(error) });
    }

    try {
      const { map, ok } = await cudyrPromise;
      const cudyrRow = map.get(encId);
      const importedCudyr = cudyrRow ? buildImportedCudyr(cudyrRow, fecha) : null;
      const existingCudyr = merged.evaluationScores?.cudyr;
      if (importedCudyr) {
        merged = {
          ...merged,
          evaluationScores: { ...merged.evaluationScores, cudyr: importedCudyr },
        };
      } else if (ok && existingCudyr && existingCudyr.recordedDate !== fecha) {
        // CUDYR is a DAILY assessment: an authoritative read with no categorization for this census
        // day removes a stale copy carried over from another day (e.g. the pre-fix as-of behavior).
        const { cudyr: _removed, ...rest } = merged.evaluationScores ?? {};
        merged = { ...merged, evaluationScores: rest };
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'cudyr', message: message(error) });
    }

    if (merged === patient) return;

    // Granular patch: only the clinical-fill fields, so a concurrent census edit/confirm on other
    // fields is never clobbered and the full-record freshness guard is never involved.
    const patch: DailyRecordPatch = {};
    if (merged.devices !== patient.devices) patch[`beds.${bedId}.devices`] = merged.devices;
    if (merged.deviceDetails !== patient.deviceDetails)
      patch[`beds.${bedId}.deviceDetails`] = merged.deviceDetails;
    if (merged.deviceInstanceHistory !== patient.deviceInstanceHistory)
      patch[`beds.${bedId}.deviceInstanceHistory`] = merged.deviceInstanceHistory;
    if (merged.evaluationScores !== patient.evaluationScores)
      patch[`beds.${bedId}.evaluationScores`] = merged.evaluationScores;
    if (Object.keys(patch).length === 0) return;

    try {
      await deps.applyPatch(patch);
      summary.patched += 1;
    } catch (error) {
      summary.errors.push({ bedId, source: 'patch', message: message(error) });
    }
  };

  for (let start = 0; start < eligible.length; start += CONCURRENCY) {
    const batch = eligible.slice(start, start + CONCURRENCY);
    await Promise.all(batch.map(([bedId, patient]) => fillPatient(bedId, patient).finally(report)));
  }

  return summary;
};
