import { collectClinicalFillStaffing } from './domain/clinicalFillStaffing';
import { needsClinicalRead } from './contracts/clinicalReadSelection';
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
import { readClinicalPatientSources } from './domain/clinicalPatientReaders';
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
import {
  createClinicalFillPerformance,
  createClinicalFillSummary,
} from './domain/clinicalFillPerformance';
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
  HistoricalCudyrBatchExecutionResult,
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
} from './contracts/clinicalFillContracts';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const READ_CONCURRENCY = 4;
export { countClinicalFillEligiblePatients } from './domain/clinicalFillCandidates';
export { createClinicalFillWatchdog } from './domain/clinicalFillWatchdog';

export const runClinicalFill = async (
  record: DailyRecord,
  fecha: string,
  deps: ClinicalFillDeps,
  onProgress?: (progress: ClinicalFillProgress) => void
): Promise<ClinicalFillSummary> => {
  const eligible = collectClinicalFillCandidates(record, deps.allowedClinicalEpisodeIds);
  const summary = createClinicalFillSummary(eligible.length);
  const needs = (encId: string, source: Parameters<typeof needsClinicalRead>[2]) =>
    needsClinicalRead(deps.pendingReads, encId, source);
  const cudyrEpisodeIds = eligible.flatMap(({ patient }) =>
    patient.clinicalEpisodeId && needs(patient.clinicalEpisodeId, 'cudyr')
      ? [patient.clinicalEpisodeId]
      : []
  );
  const readsStaffing = eligible.some(({ patient }) =>
    needs(patient.clinicalEpisodeId!, 'history')
  );
  const performance = createClinicalFillPerformance(deps.monotonicNow);
  if (eligible.length === 0) {
    if (!deps.pendingReads)
      summary.staffingProposal = inferNursingShifts([], fecha, deps.nurseCatalog, deps.tensCatalog);
    summary.performance = performance.finish(summary.incremental!);
    return summary;
  }
  // Start the shared capture now; independent patient reads may proceed while it is pending.
  const cudyrPreflight = cudyrEpisodeIds.length
    ? captureClinicalCudyrSource({
        fetch: deps.fetchCudyrCategories,
        trackRequest: performance.trackRequest,
        recordTimeout: performance.recordTimeout,
      })
    : Promise.resolve({
        source: { map: new Map(), historyAvailable: false },
        unavailableError: undefined,
      });
  const nursingObservations: NursingActivityObservation[] = [];
  const gate = () => createConcurrencyGate(READ_CONCURRENCY, deps.signal);
  const [withDeviceReadSlot, withHistoryReadSlot] = [gate(), gate()];
  const [withFormsReadSlot, withBundleReadSlot] = [gate(), gate()];
  // Reads are concurrent; writes are serialized to preserve the census revision contract.
  const writes = createClinicalWriteCoordinator(
    summary.incremental!,
    performance.writeObserver,
    deps.signal
  );
  const persistenceStrategy = deps.persistenceStrategy ?? {
    disposition: 'immediate' as const,
    persist: async () => undefined,
  };
  const pendingBatch: ClinicalFillPatchOperation[] = [];
  const cudyr = cudyrPreflight.then(({ source, unavailableError }) => {
    if (unavailableError) summary.errors.unshift(unavailableError);
    return createClinicalCudyrCoordinator({
      censusDate: fecha,
      clinicalEpisodeIds: cudyrEpisodeIds,
      source,
      applyBatch: deps.applyHistoricalCudyrBatch,
      applySingle: deps.applyHistoricalCudyr,
      enqueueWrite: operation => writes.enqueue(operation, { scope: 'historical' }),
      onPersistenceEvidence: performance.recordPersistenceEvidence,
      onRetries: performance.recordRetries,
      onHistoricalPatch: performance.recordHistoricalPatch,
      onAdministrativeOverridePreserved: performance.recordAdministrativeOverridePreserved,
      onError: error => summary.errors.push(error),
    });
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
    const [deviceResult, historyResult, formsResult] = await readClinicalPatientSources({
      encId,
      fecha,
      lookbackDays: historyReadPolicy.lookbackDays,
      pendingReads: deps.pendingReads,
      deps,
      performance,
      slots: {
        devices: withDeviceReadSlot,
        history: withHistoryReadSlot,
        forms: withFormsReadSlot,
        bundle: withBundleReadSlot,
      },
    });
    if (deviceResult.status === 'rejected') {
      reportPatientError('devices', message(deviceResult.reason));
    } else if (deviceResult.status === 'fulfilled') {
      try {
        const devices =
          deviceResult.value.source === 'json'
            ? mapRayenInvasiveDeviceEntries(deviceResult.value.entries)
            : mapInvasiveDevices(parseInvasiveDevices(deviceResult.value.textItems));
        // Additive on purpose: an empty remote list must not remove devices nursing keeps by hand.
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
      formsResult.status === 'rejected'
        ? message(formsResult.reason)
        : formsResult.status === 'fulfilled'
          ? formsResult.value.error
          : undefined;
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
        : historyResult.status === 'fulfilled'
          ? historyResult.value.error
          : undefined;
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
      // Always canonicalize, even without new scales: older versions persisted one Rayen
      // application twice under different form authors, and that duplicate must not linger.
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
      const cudyrResult = needs(encId, 'cudyr')
        ? await cudyr.then(coordinator => coordinator.apply(merged, encId, bedId))
        : { patient: merged, historicalChanged: false };
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

    if (deps.signal?.aborted) {
      reportPatientError('patch', message(deps.signal.reason ?? 'Clinical stage timeout'));
      return;
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
    applyWithMetrics: operation => writes.applyBatch(operation, { scope: 'current' }),
    recordRetries: performance.recordRetries,
    recordPersistenceEvidence: performance.recordPersistenceEvidence,
  });
  summary.patched += batchPersistence.patched;
  summary.errors.push(...batchPersistence.errors);
  if (summary.incremental && batchPersistence.batch) {
    summary.incremental.batch = batchPersistence.batch;
    summary.incremental.clinicalTargets = batchPersistence.batch.clinicalTargets;
    summary.incremental.checkpointOnlyTargets = batchPersistence.batch.checkpointOnlyTargets;
  }

  if (readsStaffing) {
    const staffing = await collectClinicalFillStaffing(nursingObservations, fecha, deps);
    summary.staffingProposal = staffing.proposal;
    if (staffing.error) summary.errors.push(staffing.error);
  }
  const cudyrSource = (await cudyrPreflight).source;
  const cudyrCacheHits = cudyrSource.historyAvailable ? Math.max(0, cudyrEpisodeIds.length - 1) : 0;
  summary.performance = performance.finish(summary.incremental!, cudyrCacheHits);

  return summary;
};
