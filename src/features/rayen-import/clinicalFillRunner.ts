import type { DailyRecord, PatientData } from './contracts/rayenDomainContracts';
import { mergeReportDevices } from './domain/mergeReportDevices';
import { mergeReportScales } from './domain/mergeReportScales';
import { parseInvasiveDevices } from './mapping/parseInvasiveDevices';
import { mapInvasiveDevices, mapRayenInvasiveDeviceEntries } from './mapping/mapDeviceToInstance';
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
import { resolveClinicalHistoryReadPolicy } from './domain/clinicalHistoryReadPolicy';
import { buildClinicalPatientPatch } from './domain/clinicalPatientPatch';

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
  const withDeviceReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  const withHistoryReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  const withFormsReadSlot = createConcurrencyGate(READ_CONCURRENCY);

  // Reads are concurrent; writes are serialized to preserve the census revision contract.
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
    const historyReadPolicy = resolveClinicalHistoryReadPolicy(
      patient.clinicalSyncCheckpoint,
      fecha,
      deps.now()
    );

    const [deviceResult, historyResult, formsResult] = await Promise.allSettled([
      withDeviceReadSlot(async () => {
        const { entries, base64, error, source } = await performance.trackRequest(() =>
          deps.fetchDeviceReport(encId, fecha)
        );
        if (error) {
          performance.recordTimeout(error);
          throw new Error(error);
        }
        if (Array.isArray(entries)) {
          return {
            entries,
            source,
            textItems: [] as Awaited<ReturnType<typeof deps.extractDeviceItems>>,
          };
        }
        return {
          entries: [],
          source,
          textItems: base64 ? await deps.extractDeviceItems(base64) : [],
        };
      }),
      withHistoryReadSlot(() =>
        performance.trackRequest(() =>
          deps.fetchHistoryScales(encId, fecha, {
            lookbackDays: historyReadPolicy.lookbackDays,
          })
        )
      ),
      withFormsReadSlot(() => performance.trackRequest(() => deps.fetchScalesForms(encId))),
    ]);

    if (deviceResult.status === 'rejected') {
      summary.errors.push({ bedId, source: 'devices', message: message(deviceResult.reason) });
    } else {
      try {
        const devices =
          deviceResult.value.source === 'json'
            ? mapRayenInvasiveDeviceEntries(deviceResult.value.entries)
            : mapInvasiveDevices(parseInvasiveDevices(deviceResult.value.textItems));
        // Device synchronization is intentionally additive: without persisted source provenance,
        // an empty remote list cannot safely remove devices maintained manually by nursing.
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

    // One forms read supplies both scales and vital signs.
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
    const historyAuthoritative = historyResult.status === 'fulfilled' && !historyReadError;
    const formsAuthoritative = formsResult.status === 'fulfilled' && !formsReadError;
    const historyFullValidationAt = historyAuthoritative
      ? historyReadPolicy.fullValidationAt
      : undefined;
    const scalesFullValidationAt =
      historyAuthoritative && formsAuthoritative ? historyReadPolicy.fullValidationAt : undefined;
    if (historyAuthoritative) {
      for (const activity of historyResult.value.nursingActivity ?? []) {
        nursingObservations.push({ ...activity, encounterId: encId });
      }
      recordIncrementalFacts(
        'staffing',
        (historyResult.value.nursingActivity ?? []).map(activity => ({
          watermark: activity.recordedAt,
          value: activity,
        })),
        { fullValidationAt: historyFullValidationAt }
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
      if (historyAuthoritative && formsAuthoritative) {
        recordIncrementalFacts(
          'scales',
          scales.map(scale => ({
            sourceId: `${scale.code}:${scale.encounterEventId}:${scale.sourceOrder ?? 0}`,
            watermark: scale.encounterEventId,
            value: scale,
          })),
          { fullValidationAt: scalesFullValidationAt }
        );
      }
    } catch (error) {
      summary.errors.push({ bedId, source: 'scales', message: message(error) });
    }

    try {
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

    const { patch, checkpointChanged, clinicalFieldCount } = buildClinicalPatientPatch(
      patient,
      merged,
      bedId,
      clinicalCrib
    );
    if (Object.keys(patch).length === 0) return;

    if (deps.applyBatch || deps.observeBatch) {
      pendingBatch.push({
        patch,
        clinicalFieldCount,
        checkpointChanged,
        target: {
          censusDate: fecha,
          bedId,
          clinicalEpisodeId: encId,
          ...(clinicalCrib ? { clinicalCrib: true as const } : {}),
        },
      });
      if (deps.applyBatch) {
        if (historicalCudyrPatched && clinicalFieldCount === 0) summary.patched += 1;
        return;
      }
    }

    try {
      await writes.applyPatientPatch(
        async captureHistorySnapshot => {
          await deps.applyPatch(patch, {
            censusDate: fecha,
            bedId,
            clinicalEpisodeId: encId,
            captureHistorySnapshot,
            ...(clinicalCrib ? { clinicalCrib: true as const } : {}),
          });
        },
        { clinicalChange: clinicalFieldCount > 0 }
      );
      if (clinicalFieldCount > 0 || historicalCudyrPatched) summary.patched += 1;
    } catch (error) {
      summary.errors.push({ bedId, source: 'patch', message: message(error) });
    }
  };

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
  if (summary.incremental && batchPersistence.batch) {
    summary.incremental.batch = batchPersistence.batch;
    summary.incremental.clinicalTargets = batchPersistence.batch.clinicalTargets;
    summary.incremental.checkpointOnlyTargets = batchPersistence.batch.checkpointOnlyTargets;
  }

  summary.staffingProposal = inferNursingShifts(
    nursingObservations,
    fecha,
    deps.nurseCatalog ?? [],
    deps.tensCatalog ?? []
  );
  summary.performance = performance.finish(summary.incremental!);

  return summary;
};
