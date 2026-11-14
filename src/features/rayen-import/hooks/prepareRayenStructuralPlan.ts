import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { createRayenSnapshotEvidenceClient } from './rayenSnapshotEvidenceClient';
import type { CapturedRayenStructuralEvidence } from './replanRayenStructure';
import { RayenPlanningStop } from '../domain/rayenPlanningStop';
import type { InvalidClinicalEpisodeIds } from '../domain/invalidClinicalEpisodePolicy';

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
  /** Episodes marked «paciente no válido», read from the server before planning. */
  invalidEpisodeIds: InvalidClinicalEpisodeIds;
  /** Test seam for the browser bridge; production always creates the live client. */
  evidenceClient?: ReturnType<typeof createRayenSnapshotEvidenceClient>;
  /** Test seam for PDF layouts; production uses the real PDF.js extractor. */
  extractStatisticalText?: (buffer: ArrayBuffer) => Promise<string>;
}

/** Captures the immutable evidence used by every CAS replan in one execution. */
export const prepareRayenStructuralPlan = async ({
  baseRecord,
  planningSnapshot: capturedSnapshot,
  bundle,
  isHistoricalDay,
  reportDate,
  dailyRecord,
  isAdmin,
  counters,
  measureEvidence,
  invalidEpisodeIds,
  evidenceClient,
  extractStatisticalText,
}: PrepareRayenStructuralPlanInput) => {
  // Structural reconstruction depends on live Eloisa evidence, so keep its comparatively large
  // resolver graph out of the offline census shell and load it only when a sync is requested.
  const { replanRayenStructure } = await import('./replanRayenStructure');
  const { excludeInvalidEpisodeRows, excludeInvalidEpisodesFromSnapshot } =
    await import('../domain/invalidClinicalEpisodePolicy');
  const planningSnapshot = excludeInvalidEpisodesFromSnapshot(capturedSnapshot, invalidEpisodeIds);
  const reportRows = excludeInvalidEpisodeRows(bundle.egresoRows, invalidEpisodeIds);
  const { enrichReportOnlyDischarges } = await import('../domain/enrichReportOnlyDischarges');
  const {
    fetchPatientFlowReport,
    fetchStatisticalDischarge,
    lookupEgresos,
    lookupHospitalizations,
  } = evidenceClient ?? createRayenSnapshotEvidenceClient(isHistoricalDay, counters);
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
  const { previousCensusDate } = await import('../domain/previousCensusContinuity');
  const { previousCensusEgresoCandidates } =
    await import('../domain/previousCensusEgresoCandidates');
  const previousDate = previousCensusDate(reportDate);
  const previous = isHistoricalDay
    ? null
    : await measureEvidence(() => dailyRecord.getAuthoritativeForDate(previousDate));
  if (previous && previous.date !== previousDate) {
    throw new RayenPlanningStop(
      'El censo previo quedó por verificar porque la fecha recibida no corresponde. Vuelve a sincronizar.'
    );
  }
  const previousCensusCandidates = excludeInvalidEpisodeRows(
    [
      ...new Map(
        [
          ...previousCensusEgresoCandidates(previous, reportRows, reportDate),
          ...previousCensusEgresoCandidates(baseRecord, reportRows, reportDate, isHistoricalDay),
        ].map(candidate => [
          [candidate.encounterId, candidate.dischargeDay, candidate.patientName].join('|'),
          candidate,
        ])
      ).values(),
    ],
    invalidEpisodeIds
  );
  const enrichedRows = await measureEvidence(() =>
    enrichReportOnlyDischarges(reportRows, reportDate, {
      fetchStatisticalDischarge,
      lookupEgresos,
      previousCensusCandidates,
      allReportDays: isHistoricalDay,
      lookupHospitalizations,
      extractText: extractStatisticalText,
      alreadyApplied: (row, exactCandidate) => {
        // Reconstruction still needs the exact episode even when its movement is already filed.
        if (isHistoricalDay) return false;
        const run = normalizeRut(row.run);
        const episode = row.encounterId || exactCandidate?.encounterId;
        // A recorded RUN alone cannot identify the bulk row's hospitalization. Complete its
        // episode from Eloísa before reconstruction, including when HHR already has an alta.
        if (!run || !episode || !hasRecordedMovement(baseRecord, run, episode)) return false;
        return (
          !findOccupiedBed(occupied, row.run, episode ?? '') &&
          !findOccupiedClinicalCrib(occupiedCribs, row.run, episode ?? '')
        );
      },
    })
  );

  // Enrichment can attach a marked episode to a report row that arrived without one.
  const egresoRows = excludeInvalidEpisodeRows(enrichedRows, invalidEpisodeIds);
  const { planRayenCensusImport } = await import('../importRayenCensusUseCase');
  const { applyEgresoReport } = await import('../domain/applyEgresoReport');
  const { recoverPreviousCensusDischarges } =
    await import('../domain/recoverPreviousCensusDischarges');
  const preliminaryDiff = applyEgresoReport(
    planRayenCensusImport({ current: baseRecord, snapshot: planningSnapshot, invalidEpisodeIds })
      .diff,
    egresoRows,
    baseRecord
  );
  const recoveredRows = await measureEvidence(() =>
    recoverPreviousCensusDischarges(
      previous,
      baseRecord,
      preliminaryDiff,
      planningSnapshot,
      lookupEgresos,
      { fetchStatisticalDischarge, extractText: extractStatisticalText }
    )
  );

  const capturedEvidence: CapturedRayenStructuralEvidence = {
    sourceSnapshot: planningSnapshot,
    egresoRows: [...egresoRows, ...excludeInvalidEpisodeRows(recoveredRows, invalidEpisodeIds)],
    reportDate,
    isHistoricalDay,
    invalidEpisodeIds,
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
