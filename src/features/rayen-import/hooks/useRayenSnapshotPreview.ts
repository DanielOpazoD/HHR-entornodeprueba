import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { applyEgresoReport } from '../domain/applyEgresoReport';
import { applyEgresoLookupFallback } from '../domain/applyEgresoLookupFallback';
import { requiresReview } from '../domain/reconcileCensus';
import {
  computePreviousDayEdits,
  verifyPreviousDayAdmissionPlacements,
} from '../domain/previousDayCorrections';
import { requestEgresoLookup } from '../bridge/rayenImportBridge';
import { requestPatientFlowReport } from '../bridge/patientFlowBridge';
import { requestStatisticalDischargeEvidence } from '../bridge/statisticalDischargeEvidenceBridge';
import {
  requestRayenExtensionHealth,
  supportsPatientFlowReport,
  supportsStatisticalDischargeEvidence,
} from '../bridge/extensionHealthBridge';
import {
  recoverMissingSnapshotPlacements,
  resolveOccupiedBedTraceabilityChain,
} from '../bedTraceabilityResolver';
import { reconstructHistoricalSnapshotAtClose } from '../domain/historicalSnapshotReconstruction';
import { createPatientFlowRequestCache } from '../domain/patientFlowRequestCache';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import { syncReportRange, toIsoReportDate } from './reportDateHelpers';
import { resolveCensusSyncTarget, type CensusSyncTarget } from '../domain/historicalCensusSync';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import { elapsedMilliseconds, isRayenTimeoutMessage } from '../domain/rayenSyncPerformance';
import { useTreatingPhysicianCatalogSync } from './useTreatingPhysicianCatalogSync';
import { buildRayenCapturePerformance } from '../domain/rayenSyncSourceQuality';
import type { ConfirmedRayenCensusApplyResult } from './useRayenCensusDiffApplication';
import type { ConfirmedRayenCensusHandoff } from './rayenCensusPersistenceGuard';
interface UseRayenSnapshotPreviewInput {
  currentRecord: DailyRecord | null | undefined;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  clearSyncTimeout: () => void;
  applyDiff: (
    record: DailyRecord,
    diff: CensusImportDiff
  ) => Promise<ConfirmedRayenCensusApplyResult>;
  persistAppliedRun: (record: DailyRecord, diff: CensusImportDiff) => Promise<DailyRecord>;
  fillDevicesInBackground: (source: DailyRecord | ConfirmedRayenCensusHandoff) => Promise<void>;
  failRun: (reason: 'apply_failed', runId?: string) => Promise<void>;
  ensureRun: () => RayenSyncRun;
  getRun: (runId: string) => RayenSyncRun | undefined;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  syncTargetRef: RefObject<CensusSyncTarget | null>;
}
export const useRayenSnapshotPreview = ({
  currentRecord,
  dailyRecord,
  isAdmin,
  setState,
  clearSyncTimeout,
  applyDiff,
  persistAppliedRun,
  fillDevicesInBackground,
  failRun,
  ensureRun,
  getRun,
  recordRunPerformance,
  syncTargetRef,
}: UseRayenSnapshotPreviewInput) => {
  const autoApplyingRef = useRef(false);
  const prepareTreatingPhysicianSnapshot = useTreatingPhysicianCatalogSync();
  return useCallback(
    async (snapshot: RayenCensusSnapshot, bundle: RayenSyncBundle, requestedRunId?: string) => {
      const run = requestedRunId ? getRun(requestedRunId) : ensureRun();
      if (!run) return;
      clearSyncTimeout();
      const planningSnapshot = prepareTreatingPhysicianSnapshot(snapshot);
      if (!currentRecord) {
        void failRun('apply_failed', run.id);
        setState(prev => ({
          ...prev,
          isSyncing: false,
          error: 'No hay censo cargado para hoy.',
        }));
        return;
      }
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
      const reportDate = toIsoReportDate(currentRecord);
      const requestedTarget = syncTargetRef.current;
      syncTargetRef.current = null;
      const completedTarget = resolveCensusSyncTarget(reportDate);
      if (
        !requestedTarget ||
        requestedTarget.kind === 'unsupported' ||
        completedTarget.kind === 'unsupported' ||
        completedTarget.clinicalDay !== requestedTarget.clinicalDay
      ) {
        void failRun('apply_failed', run.id);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error:
            requestedTarget && completedTarget.kind !== 'unsupported'
              ? 'El turno de enfermería cambió durante la captura. Vuelve a sincronizar para usar un único corte temporal.'
              : 'Solo se puede reconciliar el censo vigente o uno de los siete días clínicos anteriores.',
        }));
        return;
      }
      const isHistoricalDay = requestedTarget.kind === 'historical';
      const reportRange = syncReportRange(reportDate, requestedTarget);
      const bundleMatchesRequest =
        bundle.facilityId === snapshot.facilityId &&
        bundle.fichaMedicoCapturedAt === snapshot.capturedAt &&
        bundle.dateStart === reportRange.dateStart &&
        bundle.dateEnd === reportRange.dateEnd;
      if (!bundleMatchesRequest) {
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
      let extensionHealth: ReturnType<typeof requestRayenExtensionHealth> | null = null;
      const getExtensionHealth = () => {
        if (!extensionHealth) {
          counters.requests += 1;
          extensionHealth = requestRayenExtensionHealth();
        }
        return extensionHealth;
      };
      const fetchPatientFlowReport = createPatientFlowRequestCache(
        async encId => {
          const health = await getExtensionHealth();
          if (!supportsPatientFlowReport(health.report)) {
            return {
              base64: '',
              error: 'La extensión instalada no admite trazabilidad de camas.',
            };
          }
          counters.requests += 1;
          const result = await requestPatientFlowReport(encId, isHistoricalDay ? 15_000 : 30_000);
          if (isRayenTimeoutMessage(result.error)) counters.timeouts += 1;
          return result;
        },
        {
          onHit: () => {
            counters.cacheHits += 1;
          },
        }
      );
      const fetchStatisticalDischarge = async (encId: string) => {
        const health = await getExtensionHealth();
        if (!supportsStatisticalDischargeEvidence(health.report)) {
          return {
            base64: '',
            error: 'La extensión instalada no admite lectura del egreso individual.',
          };
        }
        counters.requests += 1;
        const result = await requestStatisticalDischargeEvidence(encId);
        if (isRayenTimeoutMessage(result.error)) counters.timeouts += 1;
        return result;
      };
      const lookupEgresos = async (targets: Parameters<typeof requestEgresoLookup>[0]) => {
        if (targets.length === 0) return [];
        counters.requests += 1;
        return requestEgresoLookup(targets);
      };
      let diff: CensusImportDiff;
      let evidenceSnapshot = planningSnapshot;
      let lookupResults: EgresoLookupResult[] = [];
      if (isHistoricalDay) {
        const reconstruction = await measureEvidence(() =>
          reconstructHistoricalSnapshotAtClose(
            reportDate,
            planningSnapshot,
            currentRecord,
            bundle.egresoRows,
            {
              fetchReport: fetchPatientFlowReport,
              lookupEgresos,
              fetchDischargeReport: fetchStatisticalDischarge,
            }
          )
        );
        diff = planRayenCensusImport({
          current: currentRecord,
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
        diff = planRayenCensusImport({ current: currentRecord, snapshot: planningSnapshot }).diff;
        diff = applyEgresoReport(diff, bundle.egresoRows, currentRecord);
        const recoveryTargets = diff.pendingAdministrativeDischarges
          .filter(entry => entry.rut && entry.encounterId)
          .map(entry => ({ run: entry.rut, encounterId: entry.encounterId as string }));
        lookupResults = await measureEvidence(() => lookupEgresos(recoveryTargets));
        const recovered = await measureEvidence(() =>
          recoverMissingSnapshotPlacements(
            currentRecord,
            planningSnapshot,
            diff,
            lookupResults,
            { fetchReport: fetchPatientFlowReport },
            recoveredSnapshot =>
              planRayenCensusImport({ current: currentRecord, snapshot: recoveredSnapshot }).diff
          )
        );
        const traceability = await measureEvidence(() =>
          resolveOccupiedBedTraceabilityChain(
            currentRecord,
            recovered.snapshot,
            recovered.diff,
            { fetchReport: fetchPatientFlowReport },
            verified => planRayenCensusImport({ current: currentRecord, snapshot: verified }).diff
          )
        );
        diff = traceability.diff;
        evidenceSnapshot = traceability.snapshot;
      }

      // Placement resolvers replan from the snapshot, so restore authoritative bundle egresos.
      diff = applyEgresoReport(diff, bundle.egresoRows, currentRecord);

      const lookupTargets = diff.pendingAdministrativeDischarges
        .filter(entry => entry.rut && entry.encounterId)
        .filter(
          entry =>
            !lookupResults.some(
              result =>
                result.encounterId === entry.encounterId &&
                result.run.replace(/[^0-9kK]/gi, '').toUpperCase() ===
                  String(entry.rut)
                    .replace(/[^0-9kK]/gi, '')
                    .toUpperCase()
            )
        )
        .map(entry => ({ run: entry.rut, encounterId: entry.encounterId as string }));
      if (lookupTargets.length > 0) {
        lookupResults = [
          ...lookupResults,
          ...(await measureEvidence(() => lookupEgresos(lookupTargets))),
        ];
      }
      if (lookupResults.length > 0) {
        diff = applyEgresoLookupFallback(diff, lookupResults, currentRecord);
      }

      diff = await measureEvidence(() =>
        verifyPreviousDayAdmissionPlacements(diff, reportDate, {
          fetchReport: fetchPatientFlowReport,
          loadHistoricalRecord: day => dailyRecord.getForDate(day),
          snapshot: evidenceSnapshot,
          currentRecord,
        })
      );
      const previousDayPlan = await measureEvidence(() =>
        computePreviousDayEdits(dailyRecord, diff, reportDate, isAdmin)
      );
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

      if (canAutoApply) {
        if (autoApplyingRef.current) return;
        autoApplyingRef.current = true;
        setState({
          diff,
          isPreviewOpen: false,
          isBusy: true,
          isSyncing: true,
          result: null,
          hasSkippedItems: false,
          error: null,
        });
        applyDiff(currentRecord, diff)
          .then(result => {
            autoApplyingRef.current = false;
            setState(prev => ({
              ...prev,
              isBusy: false,
              result,
              hasSkippedItems: result.skipped.length > 0,
            }));
            void fillDevicesInBackground(result.confirmedHandoff);
          })
          .catch(error => {
            autoApplyingRef.current = false;
            void failRun('apply_failed', run.id);
            setState(prev => ({
              ...prev,
              isBusy: false,
              isSyncing: false,
              error: getRayenImportErrorMessage(error),
            }));
          });
        return;
      }

      const hasApplicableChanges =
        diff.admissions.length +
          diff.updates.length +
          diff.moves.length +
          diff.discharges.length +
          (diff.reportEgresos?.length ?? 0) >
        0;
      const hasUnresolvedConflicts = diff.summary.conflicts > 0;
      // Even a conflict-only census review must continue clinical enrichment. Persist the run and
      // start the fill, while the state below keeps the conflict details open for the operator.
      if (!hasApplicableChanges) {
        try {
          const stamped = await persistAppliedRun(currentRecord, diff);
          void fillDevicesInBackground(stamped);
        } catch {
          void failRun('apply_failed', run.id);
          setState(prev => ({ ...prev, isSyncing: false }));
        }
      }

      setState({
        diff,
        // No-change runs continue quietly. Conflicts always open the review because their bed and
        // reason are actionable even when there is no mutation to apply.
        isPreviewOpen: hasApplicableChanges || hasUnresolvedConflicts,
        isBusy: false,
        isSyncing: !hasApplicableChanges,
        result: null,
        hasSkippedItems: false,
        error:
          run.policy?.mode === 'auto' && needsReview
            ? 'El modo automático requiere revisión: hay conflictos, altas administrativas pendientes o correcciones de días previos.'
            : null,
      });
    },
    [
      currentRecord,
      applyDiff,
      fillDevicesInBackground,
      clearSyncTimeout,
      dailyRecord,
      isAdmin,
      persistAppliedRun,
      failRun,
      ensureRun,
      getRun,
      recordRunPerformance,
      setState,
      syncTargetRef,
      prepareTreatingPhysicianSnapshot,
    ]
  );
};
