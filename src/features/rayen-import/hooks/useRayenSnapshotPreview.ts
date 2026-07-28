import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
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
import { resolveOccupiedBedTraceabilityChain } from '../bedTraceabilityResolver';
import { reconstructHistoricalSnapshotAtClose } from '../domain/historicalSnapshotReconstruction';
import { createPatientFlowRequestCache } from '../domain/patientFlowRequestCache';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import type { RayenImportMode } from '../settings/rayenImportSettings';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import { syncReportRange, toIsoReportDate } from './reportDateHelpers';
import { resolveCensusSyncTarget, type CensusSyncTarget } from '../domain/historicalCensusSync';

interface UseRayenSnapshotPreviewInput {
  currentRecord: DailyRecord | null | undefined;
  mode: RayenImportMode;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  clearSyncTimeout: () => void;
  applyDiff: (record: DailyRecord, diff: CensusImportDiff) => Promise<ApplyResult>;
  persistAppliedRun: (record: DailyRecord, diff: CensusImportDiff) => Promise<DailyRecord>;
  fillDevicesInBackground: (record: DailyRecord) => Promise<void>;
  failRun: (reason: 'apply_failed') => Promise<void>;
  syncTargetRef: RefObject<CensusSyncTarget | null>;
}

export const useRayenSnapshotPreview = ({
  currentRecord,
  mode,
  dailyRecord,
  isAdmin,
  setState,
  clearSyncTimeout,
  applyDiff,
  persistAppliedRun,
  fillDevicesInBackground,
  failRun,
  syncTargetRef,
}: UseRayenSnapshotPreviewInput) => {
  const autoApplyingRef = useRef(false);

  return useCallback(
    async (snapshot: RayenCensusSnapshot, bundle: RayenSyncBundle) => {
      clearSyncTimeout();
      if (!currentRecord) {
        void failRun('apply_failed');
        setState(prev => ({
          ...prev,
          isSyncing: false,
          error: 'No hay censo cargado para hoy.',
        }));
        return;
      }
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
        void failRun('apply_failed');
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
        void failRun('apply_failed');
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
        extensionHealth ??= requestRayenExtensionHealth();
        return extensionHealth;
      };
      const fetchPatientFlowReport = createPatientFlowRequestCache(async encId => {
        const health = await getExtensionHealth();
        if (!supportsPatientFlowReport(health.report)) {
          return {
            base64: '',
            error: 'La extensión instalada no admite trazabilidad de camas.',
          };
        }
        return requestPatientFlowReport(encId, isHistoricalDay ? 15_000 : 30_000);
      });
      const fetchStatisticalDischarge = async (encId: string) => {
        const health = await getExtensionHealth();
        if (!supportsStatisticalDischargeEvidence(health.report)) {
          return {
            base64: '',
            error: 'La extensión instalada no admite lectura del egreso individual.',
          };
        }
        return requestStatisticalDischargeEvidence(encId);
      };
      let diff: CensusImportDiff;
      if (isHistoricalDay) {
        const reconstruction = await reconstructHistoricalSnapshotAtClose(
          reportDate,
          snapshot,
          currentRecord,
          bundle.egresoRows,
          {
            fetchReport: fetchPatientFlowReport,
            lookupEgresos: targets => requestEgresoLookup(targets),
            fetchDischargeReport: fetchStatisticalDischarge,
          }
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
        diff = planRayenCensusImport({ current: currentRecord, snapshot }).diff;
        const traceability = await resolveOccupiedBedTraceabilityChain(
          currentRecord,
          snapshot,
          diff,
          { fetchReport: fetchPatientFlowReport },
          verified => planRayenCensusImport({ current: currentRecord, snapshot: verified }).diff
        );
        diff = traceability.diff;
      }

      diff = applyEgresoReport(diff, bundle.egresoRows, currentRecord);

      const lookupTargets = diff.pendingAdministrativeDischarges
        .filter(entry => entry.rut && entry.encounterId)
        .map(entry => ({ run: entry.rut, encounterId: entry.encounterId as string }));
      if (lookupTargets.length > 0) {
        const lookupResults = await requestEgresoLookup(lookupTargets);
        diff = applyEgresoLookupFallback(diff, lookupResults, currentRecord);
      }

      diff = await verifyPreviousDayAdmissionPlacements(diff, reportDate, {
        fetchReport: fetchPatientFlowReport,
        snapshot,
        currentRecord,
      });
      const previousDayPlan = await computePreviousDayEdits(dailyRecord, diff, reportDate, isAdmin);
      const previousDayEdits = previousDayPlan.edits;
      diff = { ...diff, reportEgresos: previousDayPlan.reportEgresos };
      if (previousDayEdits.length > 0) diff = { ...diff, previousDayEdits };

      const needsReview = requiresReview(diff) || previousDayEdits.length > 0;
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
            void fillDevicesInBackground(result.record);
          })
          .catch(error => {
            autoApplyingRef.current = false;
            void failRun('apply_failed');
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
        } catch (error) {
          console.warn('[rayen-import] sello de sincronización no registrado:', error);
          void failRun('apply_failed');
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
          mode === 'auto' && needsReview
            ? 'El modo automático requiere revisión: hay conflictos, altas administrativas pendientes o correcciones de días previos.'
            : null,
      });
    },
    [
      currentRecord,
      mode,
      applyDiff,
      fillDevicesInBackground,
      clearSyncTimeout,
      dailyRecord,
      isAdmin,
      persistAppliedRun,
      failRun,
      setState,
      syncTargetRef,
    ]
  );
};
