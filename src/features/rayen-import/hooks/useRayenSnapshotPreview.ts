import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
import { applyEgresoReport, markEgresoReportUnavailable } from '../domain/applyEgresoReport';
import { applyEgresoLookupFallback } from '../domain/applyEgresoLookupFallback';
import { requiresReview } from '../domain/reconcileCensus';
import { computePreviousDayEdits } from '../domain/previousDayCorrections';
import { isHistoricalCensusDay, toSafeHistoricalDiff } from '../domain/historicalCensusSync';
import { requestEgresoLookup, requestEgresoReport } from '../bridge/rayenImportBridge';
import { requestPatientFlowReport } from '../bridge/patientFlowBridge';
import {
  requestRayenExtensionHealth,
  supportsPatientFlowReport,
} from '../bridge/extensionHealthBridge';
import { resolveOccupiedBedTraceabilityChain } from '../bedTraceabilityResolver';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import type { RayenImportMode } from '../settings/rayenImportSettings';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import { nextIsoDay, toIsoReportDate } from './reportDateHelpers';

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
}: UseRayenSnapshotPreviewInput) => {
  const autoApplyingRef = useRef(false);

  return useCallback(
    async (snapshot: RayenCensusSnapshot) => {
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
      let { diff } = planRayenCensusImport({ current: currentRecord, snapshot });
      const reportDate = toIsoReportDate(currentRecord);

      if (isHistoricalCensusDay(reportDate)) {
        diff = toSafeHistoricalDiff(diff, currentRecord);
        if (diff.updates.length > 0) {
          setState({
            diff,
            isPreviewOpen: true,
            isBusy: false,
            isSyncing: false,
            result: null,
            hasSkippedItems: false,
            error: null,
          });
          return;
        }
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
        try {
          const stamped = await persistAppliedRun(currentRecord, diff);
          autoApplyingRef.current = false;
          setState(prev => ({ ...prev, isBusy: false }));
          void fillDevicesInBackground(stamped);
        } catch (error) {
          autoApplyingRef.current = false;
          void failRun('apply_failed');
          setState(prev => ({
            ...prev,
            isBusy: false,
            isSyncing: false,
            error: getRayenImportErrorMessage(error),
          }));
        }
        return;
      }

      let patientFlowSupport: Promise<boolean> | null = null;
      const fetchPatientFlowReport = async (encId: string) => {
        patientFlowSupport ??= requestRayenExtensionHealth().then(result =>
          supportsPatientFlowReport(result.report)
        );
        if (!(await patientFlowSupport)) {
          return {
            base64: '',
            error: 'La extensión instalada no admite trazabilidad de camas.',
          };
        }
        return requestPatientFlowReport(encId);
      };
      const traceability = await resolveOccupiedBedTraceabilityChain(
        currentRecord,
        snapshot,
        diff,
        { fetchReport: fetchPatientFlowReport },
        verified => planRayenCensusImport({ current: currentRecord, snapshot: verified }).diff
      );
      diff = traceability.diff;

      const reportResult = await requestEgresoReport(reportDate, nextIsoDay(reportDate));
      const reportAvailable = reportResult.ok;
      diff = reportAvailable
        ? applyEgresoReport(diff, reportResult.rows, currentRecord)
        : markEgresoReportUnavailable(diff);

      const lookupTargets = diff.pendingAdministrativeDischarges
        .filter(entry => entry.rut && entry.encounterId)
        .map(entry => ({ run: entry.rut, encounterId: entry.encounterId as string }));
      if (lookupTargets.length > 0) {
        const lookupResults = await requestEgresoLookup(lookupTargets);
        diff = applyEgresoLookupFallback(diff, lookupResults, currentRecord);
      }

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
      if (!hasApplicableChanges && reportAvailable) {
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
        isPreviewOpen: hasApplicableChanges || hasUnresolvedConflicts || !reportAvailable,
        isBusy: false,
        isSyncing: !hasApplicableChanges && reportAvailable,
        result: null,
        hasSkippedItems: false,
        error: !reportAvailable
          ? 'No fue posible verificar las altas administrativas en Gestión de Camas. Revisa esa pestaña y vuelve a sincronizar; el censo no se aplicará automáticamente.'
          : mode === 'auto' && needsReview
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
    ]
  );
};
