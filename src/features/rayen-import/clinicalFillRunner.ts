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
import { inferNursingShifts, type NursingActivityObservation } from './domain/inferNursingShifts';
import { createConcurrencyGate } from './domain/concurrencyGate';
import { collectClinicalFillCandidates } from './domain/clinicalFillCandidates';
import { createClinicalCheckpointAccumulator } from './domain/clinicalCheckpointAccumulator';
import { createClinicalWriteCoordinator } from './domain/clinicalWriteCoordinator';
import type {
  ClinicalFillDeps,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillProgress,
  ClinicalFillSummary,
} from './contracts/clinicalFillContracts';
import { createClinicalFillPerformance } from './domain/clinicalFillPerformance';
import { persistClinicalBatch } from './domain/clinicalBatchPersistence';
import {
  confirmAuthoritativeHistoryResponse,
  resolveClinicalHistoryReadPolicy,
} from './domain/clinicalHistoryReadPolicy';
import { buildClinicalPatientPatch } from './domain/clinicalPatientPatch';
import { createClinicalCudyrCoordinator } from './domain/clinicalCudyrCoordinator';
import { captureClinicalCudyrSource } from './domain/clinicalCudyrPreflight';
import { buildClinicalFillError } from './observability/rayenSyncDiagnostics';

export type {
  ClinicalFillDeps,
  ClinicalFillBatchApplyResult,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillPatchTarget,
  ClinicalFillPersistenceStrategy,
  ClinicalFillProgress,
  ClinicalFillSummary,
  HistoricalCudyrApplyResult,
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
} from './contracts/clinicalFillContracts';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const READ_CONCURRENCY = 4;

export { countClinicalFillEligiblePatients } from './domain/clinicalFillCandidates';

export const runClinicalFill = async (
  record: DailyRecord,
  fecha: string,
  deps: ClinicalFillDeps,
  onProgress?: (progress: ClinicalFillProgress) => void
): Promise<ClinicalFillSummary> => {
  const eligible = collectClinicalFillCandidates(record, deps.allowedClinicalEpisodeIds);
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
  // CUDYR is a run-level preflight: capture Gestión de Camas exactly once and establish whether
  // its official per-episode history is available before starting any patient clinical reads.
  const cudyrPreflight = await captureClinicalCudyrSource({
    fetch: deps.fetchCudyrCategories,
    trackRequest: performance.trackRequest,
    recordTimeout: performance.recordTimeout,
  });
  const cudyrSource = cudyrPreflight.source;
  if (cudyrPreflight.unavailableError) summary.errors.push(cudyrPreflight.unavailableError);
  const nursingObservations: NursingActivityObservation[] = [];
  const withDeviceReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  const withHistoryReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  const withFormsReadSlot = createConcurrencyGate(READ_CONCURRENCY);
  // Reads are concurrent; writes are serialized to preserve the census revision contract.
  const writes = createClinicalWriteCoordinator(summary.incremental!, performance.writeObserver);
  const persistenceStrategy = deps.persistenceStrategy ?? {
    disposition: 'immediate' as const,
    persist: async () => undefined,
  };
  const pendingBatch: ClinicalFillPatchOperation[] = [];
  const cudyr = createClinicalCudyrCoordinator({
    censusDate: fecha,
    clinicalEpisodeIds: eligible.flatMap(({ patient }) =>
      patient.clinicalEpisodeId ? [patient.clinicalEpisodeId] : []
    ),
    source: cudyrSource,
    applyBatch: deps.applyHistoricalCudyrBatch,
    applySingle: deps.applyHistoricalCudyr,
    enqueueWrite: writes.enqueue,
    onHistoricalPatch: performance.recordHistoricalPatch,
    onError: error => summary.errors.push(error),
  });
  let done = 0;
  const report = () => void onProgress?.({ done: ++done, total: eligible.length });
  const fillPatient = async (
    bedId: string,
    patient: PatientData,
    clinicalCrib: boolean
  ): Promise<void> => {
    const encId = patient.clinicalEpisodeId;
    if (!encId) return;
    const reportPatientError = (source: ClinicalFillError['source'], errorMessage: string): void =>
      void summary.errors.push(
        buildClinicalFillError({ bedId, clinicalEpisodeId: encId, source, error: errorMessage })
      );
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
      reportPatientError('devices', message(deviceResult.reason));
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
        reportPatientError('devices', message(error));
      }
    }
    // One forms read supplies both scales and vital signs.
    const formsReadError =
      formsResult.status === 'rejected' ? message(formsResult.reason) : formsResult.value.error;
    if (formsResult.status === 'fulfilled') performance.recordTimeout(formsResult.value.error);
    if (formsReadError) {
      reportPatientError('scales', formsReadError);
      reportPatientError('vitals', formsReadError);
    }
    const forms =
      formsResult.status === 'fulfilled' && !formsReadError ? formsResult.value.forms : [];
    const historyReadError =
      historyResult.status === 'rejected'
        ? message(historyResult.reason)
        : historyResult.value.error;
    if (historyResult.status === 'fulfilled') performance.recordTimeout(historyResult.value.error);
    if (historyReadError) {
      reportPatientError('scales', historyReadError);
      reportPatientError('staffing', historyReadError);
    }
    const historyAuthoritative = historyResult.status === 'fulfilled' && !historyReadError;
    const formsAuthoritative = formsResult.status === 'fulfilled' && !formsReadError;
    const historyAuthoritativeWindow =
      historyAuthoritative && historyResult.status === 'fulfilled'
        ? confirmAuthoritativeHistoryResponse(historyReadPolicy, historyResult.value)
        : undefined;
    // A successful HTTP response is not a full validation unless the extension certifies the exact
    // coverage boundaries. This remains false when a request crosses a Rapa Nui calendar boundary.
    const historyFullValidationAt = historyAuthoritativeWindow
      ? historyReadPolicy.fullValidationAt
      : undefined;
    const scalesFullValidationAt = formsAuthoritative ? historyFullValidationAt : undefined;
    const scalesAuthoritativeWindow = formsAuthoritative ? historyAuthoritativeWindow : undefined;
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
        {
          fullValidationAt: historyFullValidationAt,
          fullValidationAttemptAt: historyReadPolicy.fullValidationAttemptAt,
          fullValidationLookbackDays: historyReadPolicy.lookbackDays,
        }
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
      // Always pass through the canonicalizer, even when the incremental read contains no new
      // scale. Older versions could persist one Rayen application twice under different form
      // authors; waiting for a new application would leave that duplicate visible indefinitely.
      if (historyAuthoritative || formsAuthoritative) {
        merged = mergeReportScales(merged, scales, {
          censusIsoDay: fecha,
          sourceCompleteness: scalesAuthoritativeWindow ? 'authoritative' : 'partial',
          ...(scalesAuthoritativeWindow
            ? {
                authoritativeWindowStartIsoDay: scalesAuthoritativeWindow.startIsoDay,
                authoritativeWindowEndIsoDay: scalesAuthoritativeWindow.endIsoDay,
              }
            : {}),
        });
      }
      if (historyAuthoritative && formsAuthoritative) {
        recordIncrementalFacts(
          'scales',
          scales.map(scale => ({
            sourceId: `${scale.code}:${scale.encounterEventId}:${scale.sourceOrder ?? 0}`,
            watermark: scale.encounterEventId,
            value: scale,
          })),
          {
            fullValidationAt: scalesFullValidationAt,
            fullValidationAttemptAt: historyReadPolicy.fullValidationAttemptAt,
            fullValidationLookbackDays: historyReadPolicy.lookbackDays,
          }
        );
      }
    } catch (error) {
      reportPatientError('scales', message(error));
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
      reportPatientError('vitals', message(error));
    }

    try {
      const cudyrResult = await cudyr.apply(merged, encId, bedId);
      merged = cudyrResult.patient;
      historicalCudyrPatched = cudyrResult.historicalChanged;
    } catch (error) {
      reportPatientError('cudyr', message(error));
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

    if (persistenceStrategy.disposition !== 'immediate') {
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
      if (persistenceStrategy.disposition === 'deferred') {
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
      reportPatientError('patch', message(error));
    }
  };

  await Promise.all(
    eligible.map(({ bedId, patient, clinicalCrib }) =>
      fillPatient(bedId, patient, clinicalCrib).finally(report)
    )
  );

  const batchPersistence = await persistClinicalBatch({
    operations: pendingBatch,
    diagnosticRunId: deps.diagnosticRunId,
    strategy: persistenceStrategy,
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
  const cudyrCacheHits = cudyrSource.historyAvailable ? Math.max(0, eligible.length - 1) : 0;
  summary.performance = performance.finish(summary.incremental!, cudyrCacheHits);

  return summary;
};
