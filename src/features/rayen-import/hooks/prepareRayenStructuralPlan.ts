import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { createRayenSnapshotEvidenceClient } from './rayenSnapshotEvidenceClient';
import type { CapturedRayenStructuralEvidence } from './replanRayenStructure';

interface EvidenceCounters {
  requests: number;
  cacheHits: number;
  timeouts: number;
}

interface PrepareRayenStructuralPlanInput {
  baseRecord: DailyRecord;
  planningSnapshot: RayenCensusSnapshot;
  bundle: RayenSyncBundle;
  isHistoricalDay: boolean;
  reportDate: string;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  counters: EvidenceCounters;
  measureEvidence: <T>(operation: () => Promise<T>) => Promise<T>;
  /** Test seam for the browser bridge; production always creates the live client. */
  evidenceClient?: ReturnType<typeof createRayenSnapshotEvidenceClient>;
  /** Test seam for PDF layouts; production uses the real PDF.js extractor. */
  extractStatisticalText?: (buffer: ArrayBuffer) => Promise<string>;
}

/** Captures the immutable evidence used by every CAS replan in one execution. */
export const prepareRayenStructuralPlan = async ({
  baseRecord,
  planningSnapshot,
  bundle,
  isHistoricalDay,
  reportDate,
  dailyRecord,
  isAdmin,
  counters,
  measureEvidence,
  evidenceClient,
  extractStatisticalText,
}: PrepareRayenStructuralPlanInput) => {
  // Structural reconstruction depends on live Eloisa evidence, so keep its comparatively large
  // resolver graph out of the offline census shell and load it only when a sync is requested.
  const { replanRayenStructure } = await import('./replanRayenStructure');
  const { fetchPatientFlowReport, fetchStatisticalDischarge, lookupEgresos } =
    evidenceClient ?? createRayenSnapshotEvidenceClient(isHistoricalDay, counters);
  const { enrichReportOnlyDischarges } = await import('../domain/enrichReportOnlyDischarges');
  const {
    hasRecordedMovement,
    occupiedBedsByRun,
    occupiedClinicalCribsByRun,
    findOccupiedBed,
    findOccupiedClinicalCrib,
  } = await import('../domain/egresoReportPolicy');
  const { normalizeRut } = await import('@/utils/rutUtils');
  const occupied = occupiedBedsByRun(baseRecord);
  const occupiedCribs = occupiedClinicalCribsByRun(baseRecord);
  const previousCensusCandidates = isHistoricalDay
    ? []
    : await measureEvidence(async () => {
        const { previousCensusDate } = await import('../domain/previousCensusContinuity');
        const { previousCensusEgresoCandidates } =
          await import('../domain/previousCensusEgresoCandidates');
        const previous = await dailyRecord.getAuthoritativeForDate(previousCensusDate(reportDate));
        return previousCensusEgresoCandidates(previous, bundle.egresoRows, reportDate);
      });
  const egresoRows = await measureEvidence(() =>
    enrichReportOnlyDischarges(bundle.egresoRows, reportDate, {
      fetchStatisticalDischarge,
      lookupEgresos,
      previousCensusCandidates,
      extractText: extractStatisticalText,
      alreadyApplied: (row, exactCandidate) => {
        const run = normalizeRut(row.run);
        const episode = exactCandidate?.encounterId;
        if (!run || !hasRecordedMovement(baseRecord, run, episode)) return false;
        return (
          !findOccupiedBed(occupied, row.run, episode ?? '', row.documentType) &&
          !findOccupiedClinicalCrib(
            occupiedCribs,
            row.run,
            episode ?? '',
            undefined,
            row.documentType
          )
        );
      },
    })
  );

  const capturedEvidence: CapturedRayenStructuralEvidence = {
    sourceSnapshot: planningSnapshot,
    egresoRows,
    reportDate,
    isHistoricalDay,
  };
  const replanDiff = (record: DailyRecord) =>
    replanRayenStructure(record, capturedEvidence, {
      dailyRecord,
      isAdmin,
      fetchPatientFlowReport,
      fetchStatisticalDischarge,
      lookupEgresos,
      measureEvidence,
    });

  const selectedReplan = replanDiff;
  const replanWithRecovery = async (record: DailyRecord) => {
    const diff = await selectedReplan(record);
    if (bundle.dateStart >= reportDate) return diff;
    const { planHistoricalRecovery, removeCorrectionsCoveredByRecovery } =
      await import('../domain/historicalRecovery');
    const { buildInitializedDayRecord } =
      await import('@/services/repositories/dailyRecordInitializationSupport');
    const { canWritePreviousDay } = await import('../domain/previousDayCorrections');
    const historicalRecovery = await planHistoricalRecovery({
      dateStart: bundle.dateStart,
      selectedDate: reportDate,
      port: dailyRecord,
      buildEmpty: day => buildInitializedDayRecord(day, null),
      canWrite: day => canWritePreviousDay(day, isAdmin),
      reconstruct: historicalRecord =>
        replanRayenStructure(
          historicalRecord,
          {
            ...capturedEvidence,
            reportDate: historicalRecord.date,
            isHistoricalDay: true,
          },
          {
            dailyRecord,
            isAdmin,
            fetchPatientFlowReport,
            fetchStatisticalDischarge,
            lookupEgresos,
            measureEvidence,
          }
        ),
    });
    return historicalRecovery.length
      ? {
          ...diff,
          historicalRecovery,
          previousDayEdits: removeCorrectionsCoveredByRecovery(diff, historicalRecovery),
        }
      : diff;
  };
  return { diff: await replanWithRecovery(baseRecord), replanDiff: replanWithRecovery };
};
