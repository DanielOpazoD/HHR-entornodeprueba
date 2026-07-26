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
import { parseEvaluationScales } from './mapping/parseEvaluationScales';
import { mergeScaleSources } from './mapping/mergeScaleSources';
import { parseVitalSigns } from './mapping/parseVitalSigns';
import { mergeReportVitals } from './domain/mergeReportVitals';
import { buildImportedCudyr, previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import type { RayenCudyrCategory, RayenHistoryScaleEvent } from './bridge/rayenImportBridge';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type {
  NursingStaffingProposal,
  RayenNursingActivity,
} from './contracts/nursingShiftInference';
import { inferNursingShifts, type NursingActivityObservation } from './domain/inferNursingShifts';

export interface ClinicalFillDeps {
  /** Curated HHR nurse catalog used to reconcile Eloísa identities and strengthen confidence. */
  nurseCatalog?: string[];
  /** Curated HHR TENS catalog used to reconcile Eloísa Paramédico/TENS identities. */
  tensCatalog?: string[];
  fetchDeviceReport: (encId: string, fecha: string) => Promise<{ base64: string; error?: string }>;
  extractDeviceItems: (base64: string) => Promise<DeviceTextItem[]>;
  /**
   * Read one patient's risk scales as clinical-history events (real `publishDatetime` per event), so
   * `parseHistoryScales` can pick the last score applied on the census day — see `parseHistoryScales`.
   */
  fetchHistoryScales: (encId: string) => Promise<{
    events: RayenHistoryScaleEvent[];
    nursingActivity?: RayenNursingActivity[];
    error?: string;
  }>;
  /**
   * Read the same patient's risk scales from the "Instrumentos de evaluación" summary
   * (`encounterFormEntry`). Neither source is complete on its own, so the runner UNIONS both — some
   * applied scales only show here, others only in the history report — see `mergeScaleSources`.
   */
  fetchScalesForms: (encId: string) => Promise<{ forms: unknown[]; error?: string }>;
  fetchCudyrCategories: () => Promise<{ items: RayenCudyrCategory[]; error?: string }>;
  /** Persist a CUDYR on its owning prior census when synchronization is run from D + 1. */
  applyHistoricalCudyr?: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr
  ) => Promise<HistoricalCudyrApplyResult>;
  /** Apply one patient's granular patch. Throwing marks that patient as failed, nothing else. */
  applyPatch: (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) => Promise<void>;
  now: () => Date;
  createId: () => string;
}

export interface ClinicalFillPatchTarget {
  censusDate: string;
  bedId: string;
  clinicalEpisodeId: string;
  /** True when the episode belongs to the nested clinical crib rather than the principal bed. */
  clinicalCrib?: true;
}

export interface HistoricalCudyrApplyResult {
  persisted: boolean;
  changed: boolean;
  /** False when the episode did not exist in that historical census, so no archive was expected. */
  applicable?: boolean;
}

export interface ClinicalFillError {
  bedId: string;
  source: 'devices' | 'scales' | 'vitals' | 'cudyr' | 'patch';
  message: string;
}

export interface ClinicalFillSummary {
  /** Eligible patients (with clinicalEpisodeId + name). */
  total: number;
  /** Patients whose patch was applied (had at least one change). */
  patched: number;
  errors: ClinicalFillError[];
  /** Staffing review derived from text-free clinical metadata, including explicit no-data states. */
  staffingProposal?: NursingStaffingProposal;
}

export interface ClinicalFillProgress {
  done: number;
  total: number;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** How many patients are fetched concurrently (each fetch can take seconds). */
const CONCURRENCY = 4;

interface ClinicalFillCandidate {
  bedId: string;
  patient: PatientData;
  clinicalCrib: boolean;
}

const isEligible = (patient: PatientData | undefined): patient is PatientData =>
  !!patient?.clinicalEpisodeId && !!patient.patientName?.trim();

const collectClinicalFillCandidates = (record: DailyRecord): ClinicalFillCandidate[] =>
  Object.entries(record.beds).flatMap(([bedId, patient]) => {
    const candidates: ClinicalFillCandidate[] = [];
    if (isEligible(patient)) candidates.push({ bedId, patient, clinicalCrib: false });
    if (isEligible(patient?.clinicalCrib)) {
      candidates.push({ bedId, patient: patient.clinicalCrib, clinicalCrib: true });
    }
    return candidates;
  });

export const countClinicalFillEligiblePatients = (record: DailyRecord): number =>
  collectClinicalFillCandidates(record).length;

export const runClinicalFill = async (
  record: DailyRecord,
  fecha: string,
  deps: ClinicalFillDeps,
  onProgress?: (progress: ClinicalFillProgress) => void
): Promise<ClinicalFillSummary> => {
  const eligible = collectClinicalFillCandidates(record);
  const summary: ClinicalFillSummary = {
    total: eligible.length,
    patched: 0,
    errors: [],
    staffingProposal: inferNursingShifts(
      [],
      fecha,
      deps.nurseCatalog ?? [],
      deps.tensCatalog ?? []
    ),
  };
  if (eligible.length === 0) return summary;
  const nursingObservations: NursingActivityObservation[] = [];

  // Patient reports are fetched concurrently, but all record writes are serialized. Parallel
  // writes share one census version and can otherwise conflict with another write from this same
  // synchronization, producing a false "modified by another user" result.
  let writeQueue: Promise<void> = Promise.resolve();
  const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = writeQueue.then(operation);
    writeQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  };

  // One bulk CUDYR read shared by every patient; a failure/timeout costs only this source. `ok`
  // marks the read as authoritative — only then may a stale stored category be removed.
  const cudyrPromise: Promise<{ map: Map<string, RayenCudyrCategory>; ok: boolean }> = deps
    .fetchCudyrCategories()
    .then(({ items, error }) => {
      if (error) {
        summary.errors.push({ bedId: '*', source: 'cudyr', message: error });
        return { map: new Map<string, RayenCudyrCategory>(), ok: false };
      }
      return { map: new Map(items.map(item => [item.encId, item])), ok: true };
    })
    .catch(error => {
      summary.errors.push({ bedId: '*', source: 'cudyr', message: message(error) });
      return { map: new Map<string, RayenCudyrCategory>(), ok: false };
    });

  let done = 0;
  const report = (): void => {
    done += 1;
    onProgress?.({ done, total: eligible.length });
  };

  const fillPatient = async (
    bedId: string,
    patient: PatientData,
    clinicalCrib: boolean
  ): Promise<void> => {
    const encId = patient.clinicalEpisodeId;
    if (!encId) return;
    let merged = patient;
    let historicalCudyrPatched = false;

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

    // Read the scale sources ONCE (shared by scales + vitals): the history report and the
    // encounter-form-entry summary. `fetchScalesForms` now returns INSTRUMENTO (scales) AND VITAL_SIGNS
    // forms in one call. Promise.allSettled never rejects, so this is safe outside a try.
    const [historyResult, formsResult] = await Promise.allSettled([
      deps.fetchHistoryScales(encId),
      deps.fetchScalesForms(encId),
    ]);
    const formsReadError =
      formsResult.status === 'rejected' ? message(formsResult.reason) : formsResult.value.error;
    if (formsReadError) {
      summary.errors.push({ bedId, source: 'scales', message: formsReadError });
      summary.errors.push({ bedId, source: 'vitals', message: formsReadError });
    }
    const forms =
      formsResult.status === 'fulfilled' && !formsReadError ? formsResult.value.forms : [];
    if (historyResult.status === 'fulfilled' && !historyResult.value.error) {
      for (const activity of historyResult.value.nursingActivity ?? []) {
        nursingObservations.push({ ...activity, encounterId: encId });
      }
    }

    try {
      // Union BOTH scale sources — neither is complete on its own.
      const historyScales =
        historyResult.status === 'fulfilled' ? parseHistoryScales(historyResult.value.events) : [];
      const summaryScales = parseEvaluationScales(forms);
      const scales = mergeScaleSources(historyScales, summaryScales);
      if (scales.length > 0) {
        merged = mergeReportScales(merged, scales, { censusIsoDay: fecha });
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'scales', message: message(error) });
    }

    try {
      // Latest vitals come from the same encounter-form-entry forms (VITAL_SIGNS). Independent of
      // scales: a failure here never blocks them.
      if (formsResult.status === 'fulfilled' && !formsReadError) {
        const vitals = parseVitalSigns(forms);
        merged = mergeReportVitals(merged, vitals, fecha);
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'vitals', message: message(error) });
    }

    try {
      const { map, ok } = await cudyrPromise;
      const cudyrRow = map.get(encId);
      const importedCudyr = cudyrRow ? buildImportedCudyr(cudyrRow, fecha) : null;
      const priorCensusDay = previousCensusIsoDay(fecha);
      const priorCudyr = cudyrRow ? buildImportedCudyr(cudyrRow, priorCensusDay) : null;
      let priorCudyrPersisted = !priorCudyr;
      if (priorCudyr && deps.applyHistoricalCudyr) {
        try {
          const historicalResult = await enqueueWrite(() =>
            deps.applyHistoricalCudyr!(encId, priorCensusDay, priorCudyr)
          );
          const historicalNotApplicable = historicalResult.applicable === false;
          priorCudyrPersisted = historicalResult.persisted || historicalNotApplicable;
          historicalCudyrPatched = historicalResult.changed;
          if (!historicalResult.persisted && !historicalNotApplicable) {
            summary.errors.push({
              bedId,
              source: 'cudyr',
              message: `No se pudo archivar el CUDYR en el turno noche ${priorCensusDay}.`,
            });
          }
        } catch (error) {
          summary.errors.push({
            bedId,
            source: 'cudyr',
            message: `No se pudo archivar el CUDYR en el turno noche ${priorCensusDay}: ${message(error)}`,
          });
        }
      }
      const existingCudyr = merged.evaluationScores?.cudyr;
      if (importedCudyr) {
        merged = {
          ...merged,
          evaluationScores: { ...merged.evaluationScores, cudyr: importedCudyr },
        };
      } else if (ok && existingCudyr && priorCudyrPersisted) {
        // An authoritative read with no CUDYR owned by this census removes any stale local copy.
        // This also migrates pre-fix records whose stored recordedDate incorrectly matched D + 1.
        const { cudyr: _removed, ...rest } = merged.evaluationScores ?? {};
        merged = { ...merged, evaluationScores: rest };
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'cudyr', message: message(error) });
    }

    if (merged === patient) {
      if (historicalCudyrPatched) summary.patched += 1;
      return;
    }

    // Granular patch: only the clinical-fill fields, so a concurrent census edit/confirm on other
    // fields is never clobbered and the full-record freshness guard is never involved.
    const patch: DailyRecordPatch = {};
    const patchPrefix = `beds.${bedId}${clinicalCrib ? '.clinicalCrib' : ''}`;
    if (merged.devices !== patient.devices) patch[`${patchPrefix}.devices`] = merged.devices;
    if (merged.deviceDetails !== patient.deviceDetails)
      patch[`${patchPrefix}.deviceDetails`] = merged.deviceDetails;
    if (merged.deviceInstanceHistory !== patient.deviceInstanceHistory)
      patch[`${patchPrefix}.deviceInstanceHistory`] = merged.deviceInstanceHistory;
    if (merged.evaluationScores !== patient.evaluationScores)
      patch[`${patchPrefix}.evaluationScores`] = merged.evaluationScores;
    if (merged.vitalSigns !== patient.vitalSigns)
      patch[`${patchPrefix}.vitalSigns`] = merged.vitalSigns;
    if (merged.vitalSignsHistory !== patient.vitalSignsHistory)
      patch[`${patchPrefix}.vitalSignsHistory`] = merged.vitalSignsHistory;
    if (Object.keys(patch).length === 0) return;

    try {
      await enqueueWrite(() =>
        deps.applyPatch(patch, {
          censusDate: fecha,
          bedId,
          clinicalEpisodeId: encId,
          ...(clinicalCrib ? { clinicalCrib: true as const } : {}),
        })
      );
      summary.patched += 1;
    } catch (error) {
      summary.errors.push({ bedId, source: 'patch', message: message(error) });
    }
  };

  for (let start = 0; start < eligible.length; start += CONCURRENCY) {
    const batch = eligible.slice(start, start + CONCURRENCY);
    await Promise.all(
      batch.map(({ bedId, patient, clinicalCrib }) =>
        fillPatient(bedId, patient, clinicalCrib).finally(report)
      )
    );
  }

  summary.staffingProposal = inferNursingShifts(
    nursingObservations,
    fecha,
    deps.nurseCatalog ?? [],
    deps.tensCatalog ?? []
  );

  return summary;
};
