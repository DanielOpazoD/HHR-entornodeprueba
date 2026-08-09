import { useCallback, useRef } from 'react';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { applyEgresoReport } from '../domain/applyEgresoReport';
import { applyEgresoLookupFallback } from '../domain/applyEgresoLookupFallback';
import { requiresReview } from '../domain/reconcileCensus';
import {
  computePreviousDayEdits,
  verifyPreviousDayAdmissionPlacements,
} from '../domain/previousDayCorrections';
import {
  recoverMissingSnapshotPlacements,
  resolveOccupiedBedTraceabilityChain,
} from '../bedTraceabilityResolver';
import { reconstructHistoricalSnapshotAtClose } from '../domain/historicalSnapshotReconstruction';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { getRayenImportErrorMessage } from './rayenImportState';
import { toIsoReportDate } from './reportDateHelpers';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import { useTreatingPhysicianCatalogSync } from './useTreatingPhysicianCatalogSync';
import { buildRayenCapturePerformance } from '../domain/rayenSyncSourceQuality';
import { validatePreparedRayenSyncContextAtCompletion } from './rayenSyncTemporalContext';
import { isRayenSyncExecutionCurrent, rayenSyncExecutionKey } from './rayenSyncExecutionState';
import { createRayenSnapshotEvidenceClient } from './rayenSnapshotEvidenceClient';
import { createRayenSnapshotExecutionReporter } from './rayenSnapshotExecutionReporter';
import {
  hasNoApplicableRayenStructuralChanges,
  resolveRayenSnapshotPlanningStage,
} from './rayenSnapshotPlanningDecision';
import type { UseRayenSnapshotPreviewInput } from './rayenSnapshotPreviewContracts';
import { collectEgresoLookupTargets } from './rayenSnapshotLookupTargets';

export const useRayenSnapshotPreview = ({
  dailyRecord,
  isAdmin,
  setState,
  dispatchExecution = () => undefined,
  executionRef,
  selectedDateRef,
  clearSyncTimeout,
  applyDiff,
  persistAppliedRun,
  fillDevicesInBackground,
  failRun,
  ensureRun,
  getRun,
  recordRunPerformance,
  preparedSyncContextRef,
  runSerializedPersistence,
}: UseRayenSnapshotPreviewInput) => {
  const persistenceExecutionKeysRef = useRef(new Set<string>());
  const prepareTreatingPhysicianSnapshot = useTreatingPhysicianCatalogSync();
  return useCallback(
    async (
      snapshot: RayenCensusSnapshot,
      bundle: RayenSyncBundle,
      requestedRunId: string,
      requestId: string
    ) => {
      const run = requestedRunId ? getRun(requestedRunId) : ensureRun();
      if (!run) return;
      const requestIdentity = { runId: run.id, requestId };
      if (!isRayenSyncExecutionCurrent(executionRef?.current, requestIdentity)) return;
      clearSyncTimeout();
      const planningSnapshot = prepareTreatingPhysicianSnapshot(snapshot);
      const preparedContext = preparedSyncContextRef.current;
      if (!preparedContext || preparedContext.runId !== run.id) {
        createRayenSnapshotExecutionReporter(dispatchExecution, {
          runId: run.id,
          requestId,
        }).transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id);
        setState(prev => ({
          ...prev,
          isSyncing: false,
          error: 'No se pudo confirmar el contexto temporal de esta sincronización.',
        }));
        return;
      }
      const baseRecord = preparedContext.record;
      const executionIdentity = {
        runId: run.id,
        requestId,
        selectedDate: preparedContext.selectedDate,
      };
      if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
      const execution = createRayenSnapshotExecutionReporter(dispatchExecution, executionIdentity);
      execution.transition({ type: 'planning_structure' });
      recordRunPerformance(
        buildRayenCapturePerformance(
          snapshot,
          planningSnapshot,
          elapsedMilliseconds(Date.parse(run.startedAt))
        ),
        run.id
      );
      const reconciliationStartedAt = Date.now();
      let historicalEvidenceMs = 0;
      const counters = { requests: 0, cacheHits: 0, timeouts: 0 };
      const measureEvidence = async <T>(operation: () => Promise<T>): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await operation();
        } finally {
          historicalEvidenceMs += elapsedMilliseconds(startedAt);
        }
      };
      const reportDate = toIsoReportDate(baseRecord);
      const requestedTarget = preparedContext.target;
      const temporalValidation = validatePreparedRayenSyncContextAtCompletion(preparedContext);
      if (!temporalValidation.valid) {
        execution.transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error:
            temporalValidation.reason === 'clinical_day_changed'
              ? 'El turno de enfermería cambió durante la captura. Vuelve a sincronizar para usar un único corte temporal.'
              : 'Solo se puede reconciliar el censo vigente o uno de los siete días clínicos anteriores.',
        }));
        return;
      }
      const isHistoricalDay = requestedTarget.kind === 'historical';
      const reportRange = preparedContext.range;
      const bundleMatchesRequest =
        bundle.facilityId === snapshot.facilityId &&
        bundle.fichaMedicoCapturedAt === snapshot.capturedAt &&
        bundle.dateStart === reportRange.dateStart &&
        bundle.dateEnd === reportRange.dateEnd;
      if (!bundleMatchesRequest) {
        execution.transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error:
            'La evidencia de Ficha Médico y Gestión de Camas no corresponde al mismo censo. Vuelve a sincronizar.',
        }));
        return;
      }
      const { fetchPatientFlowReport, fetchStatisticalDischarge, lookupEgresos } =
        createRayenSnapshotEvidenceClient(isHistoricalDay, counters);
      let diff: CensusImportDiff;
      let evidenceSnapshot = planningSnapshot;
      let lookupResults: EgresoLookupResult[] = [];
      if (isHistoricalDay) {
        const reconstruction = await measureEvidence(() =>
          reconstructHistoricalSnapshotAtClose(
            reportDate,
            planningSnapshot,
            baseRecord,
            bundle.egresoRows,
            {
              fetchReport: fetchPatientFlowReport,
              lookupEgresos,
              fetchDischargeReport: fetchStatisticalDischarge,
            }
          )
        );
        diff = planRayenCensusImport({
          current: baseRecord,
          snapshot: reconstruction.snapshot,
        }).diff;
        if (reconstruction.conflicts.length > 0) {
          diff = {
            ...diff,
            conflicts: [...diff.conflicts, ...reconstruction.conflicts],
            summary: {
              ...diff.summary,
              conflicts: diff.conflicts.length + reconstruction.conflicts.length,
            },
          };
        }
      } else {
        diff = planRayenCensusImport({ current: baseRecord, snapshot: planningSnapshot }).diff;
        diff = applyEgresoReport(diff, bundle.egresoRows, baseRecord);
        const recoveryTargets = collectEgresoLookupTargets(diff);
        lookupResults = await measureEvidence(() => lookupEgresos(recoveryTargets));
        const recovered = await measureEvidence(() =>
          recoverMissingSnapshotPlacements(
            baseRecord,
            planningSnapshot,
            diff,
            lookupResults,
            { fetchReport: fetchPatientFlowReport },
            recoveredSnapshot =>
              planRayenCensusImport({ current: baseRecord, snapshot: recoveredSnapshot }).diff
          )
        );
        const traceability = await measureEvidence(() =>
          resolveOccupiedBedTraceabilityChain(
            baseRecord,
            recovered.snapshot,
            recovered.diff,
            { fetchReport: fetchPatientFlowReport },
            verified => planRayenCensusImport({ current: baseRecord, snapshot: verified }).diff
          )
        );
        diff = traceability.diff;
        evidenceSnapshot = traceability.snapshot;
      }
      // Reapply after snapshot replans so report-only discharges survive.
      diff = applyEgresoReport(diff, bundle.egresoRows, baseRecord);
      const lookupTargets = collectEgresoLookupTargets(diff, lookupResults);
      if (lookupTargets.length > 0) {
        lookupResults = [
          ...lookupResults,
          ...(await measureEvidence(() => lookupEgresos(lookupTargets))),
        ];
      }
      if (lookupResults.length > 0) {
        diff = applyEgresoLookupFallback(diff, lookupResults, baseRecord);
      }

      diff = await measureEvidence(() =>
        verifyPreviousDayAdmissionPlacements(diff, reportDate, {
          fetchReport: fetchPatientFlowReport,
          loadHistoricalRecord: day => dailyRecord.getForDate(day),
          snapshot: evidenceSnapshot,
          currentRecord: baseRecord,
        })
      );
      const previousDayPlan = await measureEvidence(() =>
        computePreviousDayEdits(dailyRecord, diff, reportDate, isAdmin)
      );
      // Planning can span multiple network reads. Once another run/date supersedes this capture,
      // its diff must never reach persistence or revive the review UI.
      if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
      const previousDayEdits = previousDayPlan.edits;
      diff = { ...diff, reportEgresos: previousDayPlan.reportEgresos };
      if (previousDayEdits.length > 0) diff = { ...diff, previousDayEdits };
      recordRunPerformance(
        {
          stagesMs: {
            reconciliation: elapsedMilliseconds(reconciliationStartedAt),
            historicalEvidence: historicalEvidenceMs,
          },
          counters,
        },
        run.id
      );

      const needsReview = requiresReview(diff) || previousDayEdits.length > 0;
      const canAutoApply = run.policy?.mode === 'auto' && !needsReview;
      const structuralConflictCount = Math.max(diff.conflicts.length, diff.summary.conflicts);
      execution.recordOutcome({ structuralConflicts: structuralConflictCount });

      if (canAutoApply) {
        if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
        const autoApplyKey = rayenSyncExecutionKey(executionIdentity);
        if (persistenceExecutionKeysRef.current.has(autoApplyKey)) return;
        persistenceExecutionKeysRef.current.add(autoApplyKey);
        execution.transition({ type: 'persisting_structure' });
        setState({
          diff,
          isPreviewOpen: false,
          isBusy: true,
          isSyncing: true,
          result: null,
          hasSkippedItems: false,
          error: null,
        });
        try {
          const result = await runSerializedPersistence(() =>
            isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)
              ? applyDiff(baseRecord, diff)
              : Promise.resolve(null)
          );
          if (!result) return;
          const isCurrent = isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity);
          if (isCurrent) {
            execution.recordOutcome({ skippedItems: result.skipped.length });
            preparedSyncContextRef.current = null;
            setState(prev => ({
              ...prev,
              isBusy: false,
              result,
              hasSkippedItems: result.skipped.length > 0,
            }));
            execution.transition({ type: 'verifying_structure' });
            execution.transition({ type: 'syncing_clinical' });
          }
          // The committed handoff must reach clinical enrichment even when its UI execution was
          // superseded. The clinical queue validates the original run before writing.
          void fillDevicesInBackground(result.confirmedHandoff);
        } catch (error) {
          if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
          preparedSyncContextRef.current = null;
          void failRun('apply_failed', run.id);
          execution.transition({ type: 'failed' });
          setState(prev => ({
            ...prev,
            isBusy: false,
            isSyncing: false,
            error: getRayenImportErrorMessage(error),
          }));
        } finally {
          persistenceExecutionKeysRef.current.delete(autoApplyKey);
        }
        return;
      }

      const hasUnresolvedConflicts = structuralConflictCount > 0;
      const hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
      if (hasNoApplicableChanges) {
        const noChangePersistenceKey = rayenSyncExecutionKey(executionIdentity);
        if (persistenceExecutionKeysRef.current.has(noChangePersistenceKey)) return;
        persistenceExecutionKeysRef.current.add(noChangePersistenceKey);
        try {
          if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
          execution.transition({ type: 'persisting_structure' });
          const stamped = await runSerializedPersistence(() =>
            isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)
              ? persistAppliedRun(baseRecord, diff)
              : Promise.resolve(null)
          );
          if (!stamped) return;
          const isCurrent = isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity);
          if (isCurrent) {
            execution.transition({ type: 'verifying_structure' });
            execution.transition({ type: 'syncing_clinical' });
            preparedSyncContextRef.current = null;
          }
          void fillDevicesInBackground(stamped);
        } catch (error) {
          if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
          execution.transition({ type: 'failed' });
          preparedSyncContextRef.current = null;
          void failRun('apply_failed', run.id);
          const isExecutionDateVisible =
            !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
          setState(prev => ({
            ...prev,
            isBusy: false,
            isSyncing: false,
            ...(isExecutionDateVisible ? { error: getRayenImportErrorMessage(error) } : {}),
          }));
          return;
        } finally {
          persistenceExecutionKeysRef.current.delete(noChangePersistenceKey);
        }
      }

      if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
      const isExecutionDateVisible =
        !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
      setState(previous =>
        isExecutionDateVisible
          ? {
              diff,
              isPreviewOpen: !hasNoApplicableChanges || hasUnresolvedConflicts,
              isBusy: false,
              isSyncing: hasNoApplicableChanges,
              result: null,
              hasSkippedItems: false,
              error:
                run.policy?.mode === 'auto' && needsReview
                  ? 'El modo automático requiere revisión: hay conflictos, altas administrativas pendientes o correcciones de días previos.'
                  : null,
            }
          : { ...previous, isBusy: false }
      );
      execution.transition(
        resolveRayenSnapshotPlanningStage(hasNoApplicableChanges, hasUnresolvedConflicts)
      );
    },
    [
      applyDiff,
      dispatchExecution,
      executionRef,
      selectedDateRef,
      fillDevicesInBackground,
      clearSyncTimeout,
      dailyRecord,
      isAdmin,
      persistAppliedRun,
      failRun,
      ensureRun,
      getRun,
      recordRunPerformance,
      runSerializedPersistence,
      setState,
      preparedSyncContextRef,
      prepareTreatingPhysicianSnapshot,
    ]
  );
};
