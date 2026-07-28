/**
 * Orchestrates the Rayen clinical fill (invasive devices + evaluation scales + CUDYR) as an
 * INDEPENDENT, testable unit. All IO goes through injected ports, and results are applied as
 * GRANULAR PER-PATIENT PATCHES (`beds.{bedId}.devices`, `beds.{bedId}.evaluationScores`, …) instead
 * of full-record saves. The established mode applies each patch as it arrives; the optional batch
 * port accumulates the same allowlisted patches for one backend transaction.
 *
 * Independence guarantees:
 * - Each SOURCE (devices / scales / CUDYR) is best-effort per patient; one failing never blocks
 *   the others. Failures are collected into the summary, not thrown.
 * - Each PATIENT read is independent. Per-patient persistence remains isolated in the established
 *   mode; transactional mode deliberately accepts or rejects the complete bounded batch.
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
import { parseInvasiveDevices } from './mapping/parseInvasiveDevices';
import { mapInvasiveDevices } from './mapping/mapDeviceToInstance';
import { parseHistoryScales } from './mapping/parseHistoryScales';
import { parseEvaluationScales } from './mapping/parseEvaluationScales';
import { mergeScaleSources } from './mapping/mergeScaleSources';
import { parseVitalSigns } from './mapping/parseVitalSigns';
import { mergeReportVitals } from './domain/mergeReportVitals';
import { buildImportedCudyr, previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import { inferNursingShifts, type NursingActivityObservation } from './domain/inferNursingShifts';
import { createConcurrencyGate } from './domain/concurrencyGate';
import { clinicalValuesEqual } from './domain/clinicalIncrementalSync';
import { collectClinicalFillCandidates } from './domain/clinicalFillCandidates';
import { createClinicalCheckpointAccumulator } from './domain/clinicalCheckpointAccumulator';
import { createClinicalWriteCoordinator } from './domain/clinicalWriteCoordinator';
import type {
  ClinicalFillDeps,
  ClinicalFillPatchOperation,
  ClinicalFillProgress,
  ClinicalFillSummary,
} from './contracts/clinicalFillContracts';
import type { RayenCudyrCategory } from './bridge/rayenImportBridge';
import { createClinicalFillPerformance } from './domain/clinicalFillPerformance';
import { persistClinicalBatch } from './domain/clinicalBatchPersistence';

export type {
  ClinicalFillDeps,
  ClinicalFillBatchApplyResult,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillPatchTarget,
  ClinicalFillProgress,
  ClinicalFillSummary,
  HistoricalCudyrApplyResult,
} from './contracts/clinicalFillContracts';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Maximum concurrent reads per remote source. */
const READ_CONCURRENCY = 4;

export { countClinicalFillEligiblePatients } from './domain/clinicalFillCandidates';

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
    incremental: {
      received: 0,
      newFacts: 0,
      duplicates: 0,
      corrections: 0,
      patientWrites: 0,
      historySnapshots: 0,
    },
    staffingProposal: inferNursingShifts(
      [],
      fecha,
      deps.nurseCatalog ?? [],
      deps.tensCatalog ?? []
    ),
  };
  const performance = createClinicalFillPerformance(deps.monotonicNow);
  if (eligible.length === 0) {
    summary.performance = performance.finish(summary.incremental!);
    return summary;
  }
  const nursingObservations: NursingActivityObservation[] = [];
  // Each source gets independent backpressure. A slow device PDF must not consume the slots used
  // by history/forms, while every Eloisa endpoint still stays below the same conservative limit.
  const withDeviceReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  const withHistoryReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  const withFormsReadSlot = createConcurrencyGate(READ_CONCURRENCY);

  // Patient reports are fetched concurrently, but all record writes are serialized. Parallel
  // writes share one census version and can otherwise conflict with another write from this same
  // synchronization, producing a false "modified by another user" result.
  const writes = createClinicalWriteCoordinator(summary.incremental!, performance.writeObserver);
  const pendingBatch: ClinicalFillPatchOperation[] = [];

  // One bulk CUDYR read shared by every patient; a failure/timeout costs only this source. `ok`
  // marks the read as authoritative — only then may a stale stored category be removed.
  const cudyrPromise: Promise<{ map: Map<string, RayenCudyrCategory>; ok: boolean }> = performance
    .trackRequest(() => deps.fetchCudyrCategories())
    .then(({ items, error }) => {
      if (error) {
        performance.recordTimeout(error);
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
    const recordIncrementalFacts = createClinicalCheckpointAccumulator(
      patient,
      summary.incremental!,
      clinicalSyncCheckpoint => {
        merged = { ...merged, clinicalSyncCheckpoint };
      }
    );

    // Start every independent patient source together. Source-specific gates avoid head-of-line
    // blocking: four slow PDFs no longer prevent another patient's history/forms from starting.
    const [deviceResult, historyResult, formsResult] = await Promise.allSettled([
      withDeviceReadSlot(async () => {
        const { base64, error } = await performance.trackRequest(() =>
          deps.fetchDeviceReport(encId, fecha)
        );
        if (error) {
          performance.recordTimeout(error);
          throw new Error(error);
        }
        return base64 ? deps.extractDeviceItems(base64) : [];
      }),
      withHistoryReadSlot(() => performance.trackRequest(() => deps.fetchHistoryScales(encId))),
      withFormsReadSlot(() => performance.trackRequest(() => deps.fetchScalesForms(encId))),
    ]);

    if (deviceResult.status === 'rejected') {
      summary.errors.push({ bedId, source: 'devices', message: message(deviceResult.reason) });
    } else {
      try {
        const devices = mapInvasiveDevices(parseInvasiveDevices(deviceResult.value));
        if (devices.length > 0) {
          merged = mergeReportDevices(merged, devices, {
            now: deps.now(),
            createId: deps.createId,
          });
        }
      } catch (error) {
        summary.errors.push({ bedId, source: 'devices', message: message(error) });
      }
    }

    // Read the scale sources ONCE (shared by scales + vitals): the history report and the
    // encounter-form-entry summary. `fetchScalesForms` returns INSTRUMENTO (scales) AND VITAL_SIGNS
    // forms in one call. Promise.allSettled isolates every source failure.
    const formsReadError =
      formsResult.status === 'rejected' ? message(formsResult.reason) : formsResult.value.error;
    if (formsResult.status === 'fulfilled') performance.recordTimeout(formsResult.value.error);
    if (formsReadError) {
      summary.errors.push({ bedId, source: 'scales', message: formsReadError });
      summary.errors.push({ bedId, source: 'vitals', message: formsReadError });
    }
    const forms =
      formsResult.status === 'fulfilled' && !formsReadError ? formsResult.value.forms : [];
    const historyReadError =
      historyResult.status === 'rejected'
        ? message(historyResult.reason)
        : historyResult.value.error;
    if (historyResult.status === 'fulfilled') performance.recordTimeout(historyResult.value.error);
    if (historyReadError) {
      summary.errors.push({ bedId, source: 'scales', message: historyReadError });
      summary.errors.push({ bedId, source: 'staffing', message: historyReadError });
    }
    if (historyResult.status === 'fulfilled' && !historyReadError) {
      for (const activity of historyResult.value.nursingActivity ?? []) {
        nursingObservations.push({ ...activity, encounterId: encId });
      }
      recordIncrementalFacts(
        'staffing',
        (historyResult.value.nursingActivity ?? []).map(activity => ({
          watermark: activity.recordedAt,
          value: activity,
        }))
      );
    }

    try {
      // Union BOTH scale sources — neither is complete on its own.
      const historyScales =
        historyResult.status === 'fulfilled' && !historyReadError
          ? parseHistoryScales(historyResult.value.events)
          : [];
      const summaryScales = parseEvaluationScales(forms);
      const scales = mergeScaleSources(historyScales, summaryScales);
      if (scales.length > 0) {
        merged = mergeReportScales(merged, scales, { censusIsoDay: fecha });
      }
      if (!historyReadError && !formsReadError) {
        recordIncrementalFacts(
          'scales',
          scales.map(scale => ({
            sourceId: `${scale.code}:${scale.encounterEventId}:${scale.sourceOrder ?? 0}`,
            watermark: scale.encounterEventId,
            value: scale,
          }))
        );
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
        recordIncrementalFacts(
          'vitals',
          vitals.map(vital => ({
            sourceId: vital.sourceEventId,
            watermark: vital.sourceEventId ?? `${vital.recordedDate}|${vital.recordedAt}`,
            value: vital,
          }))
        );
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
          const historicalResult = await writes.enqueue(() =>
            deps.applyHistoricalCudyr!(encId, priorCensusDay, priorCudyr)
          );
          const historicalNotApplicable = historicalResult.applicable === false;
          priorCudyrPersisted = historicalResult.persisted || historicalNotApplicable;
          historicalCudyrPatched = historicalResult.changed;
          if (historicalResult.changed) performance.recordHistoricalPatch();
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
        if (!clinicalValuesEqual(existingCudyr, importedCudyr)) {
          merged = {
            ...merged,
            evaluationScores: { ...merged.evaluationScores, cudyr: importedCudyr },
          };
        }
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
    if (merged.clinicalSyncCheckpoint !== patient.clinicalSyncCheckpoint)
      patch[`${patchPrefix}.clinicalSyncCheckpoint`] = merged.clinicalSyncCheckpoint;
    if (Object.keys(patch).length === 0) return;

    if (deps.applyBatch || deps.observeBatch) {
      pendingBatch.push({
        patch,
        target: {
          censusDate: fecha,
          bedId,
          clinicalEpisodeId: encId,
          ...(clinicalCrib ? { clinicalCrib: true as const } : {}),
        },
      });
      if (deps.applyBatch) return;
    }

    try {
      await writes.applyPatientPatch(async captureHistorySnapshot => {
        await deps.applyPatch(patch, {
          censusDate: fecha,
          bedId,
          clinicalEpisodeId: encId,
          captureHistorySnapshot,
          ...(clinicalCrib ? { clinicalCrib: true as const } : {}),
        });
      });
      summary.patched += 1;
    } catch (error) {
      summary.errors.push({ bedId, source: 'patch', message: message(error) });
    }
  };

  // Schedule every patient once. The read gate above provides backpressure and releases its slot
  // before parsing/serialized Firestore writes, so a slow write no longer blocks the next patient
  // from starting its independent Eloisa reads.
  await Promise.all(
    eligible.map(({ bedId, patient, clinicalCrib }) =>
      fillPatient(bedId, patient, clinicalCrib).finally(report)
    )
  );

  const batchPersistence = await persistClinicalBatch({
    operations: pendingBatch,
    applyBatch: deps.applyBatch,
    observeBatch: deps.observeBatch,
    applyWithMetrics: writes.applyBatch,
    recordRetries: performance.recordRetries,
  });
  summary.patched += batchPersistence.patched;
  summary.errors.push(...batchPersistence.errors);

  summary.staffingProposal = inferNursingShifts(
    nursingObservations,
    fecha,
    deps.nurseCatalog ?? [],
    deps.tensCatalog ?? []
  );
  summary.performance = performance.finish(summary.incremental!);

  return summary;
};
