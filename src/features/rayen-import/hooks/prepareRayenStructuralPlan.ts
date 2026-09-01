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
}: PrepareRayenStructuralPlanInput) => {
  // Structural reconstruction depends on live Eloisa evidence, so keep its comparatively large
  // resolver graph out of the offline census shell and load it only when a sync is requested.
  const { replanRayenStructure } = await import('./replanRayenStructure');
  const { fetchPatientFlowReport, fetchStatisticalDischarge, lookupEgresos } =
    createRayenSnapshotEvidenceClient(isHistoricalDay, counters);
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
  const egresoRows = await measureEvidence(() =>
    enrichReportOnlyDischarges(bundle.egresoRows, reportDate, {
      fetchStatisticalDischarge,
      lookupEgresos,
      alreadyApplied: row => {
        const run = normalizeRut(row.run);
        if (!run || !hasRecordedMovement(baseRecord, run)) return false;
        return (
          !findOccupiedBed(occupied, row.run, '') &&
          !findOccupiedClinicalCrib(occupiedCribs, row.run, '')
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

  return { diff: await replanDiff(baseRecord), replanDiff };
};
