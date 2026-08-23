import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { CensusImportDiff, ConflictEntry } from '../contracts/censusImportDiff';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import {
  recoverMissingSnapshotPlacements,
  resolveOccupiedBedTraceabilityChain,
  type PatientFlowReportResult,
} from '../bedTraceabilityResolver';
import { applyEgresoLookupFallback } from '../domain/applyEgresoLookupFallback';
import { applyEgresoReport } from '../domain/applyEgresoReport';
import { reconstructHistoricalSnapshotAtClose } from '../domain/historicalSnapshotReconstruction';
import {
  computePreviousDayEdits,
  verifyPreviousDayAdmissionPlacements,
} from '../domain/previousDayCorrections';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { collectEgresoLookupTargets } from './rayenSnapshotLookupTargets';

export interface CapturedRayenStructuralEvidence {
  /** Immutable Ficha Medico capture used throughout this execution. */
  sourceSnapshot: RayenCensusSnapshot;
  egresoRows: readonly EgresoReportRow[];
  reportDate: string;
  isHistoricalDay: boolean;
}

interface ReplanRayenStructureDependencies {
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  fetchPatientFlowReport: (encounterId: string) => Promise<PatientFlowReportResult>;
  fetchStatisticalDischarge: (encounterId: string) => Promise<PatientFlowReportResult>;
  lookupEgresos: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
  measureEvidence?: <T>(operation: () => Promise<T>) => Promise<T>;
}

const appendConflicts = (
  diff: CensusImportDiff,
  conflicts: readonly ConflictEntry[]
): CensusImportDiff => {
  if (conflicts.length === 0) return diff;
  const conflictKey = (conflict: ConflictEntry): string =>
    [
      conflict.code ?? '',
      conflict.bedId ?? '',
      conflict.source?.encounterId ??
        conflict.blockedAdmission?.patient.clinicalEpisodeId ??
        conflict.blockedAdmission?.source?.encounterId ??
        conflict.blockedMove?.source.encounterId ??
        '',
      conflict.reason,
    ].join('|');
  const known = new Set(diff.conflicts.map(conflictKey));
  const nextConflicts = [...diff.conflicts];
  for (const conflict of conflicts) {
    const key = conflictKey(conflict);
    if (known.has(key)) continue;
    known.add(key);
    nextConflicts.push(conflict);
  }
  return {
    ...diff,
    conflicts: nextConflicts,
    summary: { ...diff.summary, conflicts: nextConflicts.length },
  };
};

/**
 * Rebuilds a structural diff against a fresh HHR revision without recapturing Rayen.
 * Every retry consumes the same immutable evidence bundle gathered by the original execution.
 */
export const replanRayenStructure = async (
  record: DailyRecord,
  evidence: CapturedRayenStructuralEvidence,
  dependencies: ReplanRayenStructureDependencies
): Promise<CensusImportDiff> => {
  const measure = dependencies.measureEvidence ?? (async operation => operation());
  let evidenceSnapshot = evidence.sourceSnapshot;
  let lookupResults: EgresoLookupResult[] = [];
  let diff: CensusImportDiff;

  if (evidence.isHistoricalDay) {
    const reconstruction = await measure(() =>
      reconstructHistoricalSnapshotAtClose(
        evidence.reportDate,
        evidence.sourceSnapshot,
        record,
        [...evidence.egresoRows],
        {
          fetchReport: dependencies.fetchPatientFlowReport,
          lookupEgresos: dependencies.lookupEgresos,
          fetchDischargeReport: dependencies.fetchStatisticalDischarge,
        }
      )
    );
    evidenceSnapshot = reconstruction.snapshot;
    diff = planRayenCensusImport({ current: record, snapshot: evidenceSnapshot }).diff;
    diff = appendConflicts(diff, reconstruction.conflicts);
  } else {
    diff = planRayenCensusImport({ current: record, snapshot: evidenceSnapshot }).diff;
    diff = applyEgresoReport(diff, [...evidence.egresoRows], record);
    lookupResults = await measure(() =>
      dependencies.lookupEgresos(collectEgresoLookupTargets(diff))
    );
    const recovered = await measure(() =>
      recoverMissingSnapshotPlacements(
        record,
        evidenceSnapshot,
        diff,
        lookupResults,
        { fetchReport: dependencies.fetchPatientFlowReport },
        snapshot => planRayenCensusImport({ current: record, snapshot }).diff
      )
    );
    const traceability = await measure(() =>
      resolveOccupiedBedTraceabilityChain(
        record,
        recovered.snapshot,
        recovered.diff,
        { fetchReport: dependencies.fetchPatientFlowReport },
        snapshot => planRayenCensusImport({ current: record, snapshot }).diff
      )
    );
    evidenceSnapshot = traceability.snapshot;
    diff = traceability.diff;
  }

  diff = applyEgresoReport(diff, [...evidence.egresoRows], record);
  const lookupTargets = collectEgresoLookupTargets(diff, lookupResults);
  if (lookupTargets.length > 0) {
    lookupResults = [
      ...lookupResults,
      ...(await measure(() => dependencies.lookupEgresos(lookupTargets))),
    ];
  }
  if (lookupResults.length > 0) {
    diff = applyEgresoLookupFallback(diff, lookupResults, record);
  }
  diff = await measure(() =>
    verifyPreviousDayAdmissionPlacements(diff, evidence.reportDate, {
      fetchReport: dependencies.fetchPatientFlowReport,
      loadHistoricalRecord: day => dependencies.dailyRecord.getAuthoritativeForDate(day),
      snapshot: evidenceSnapshot,
      currentRecord: record,
    })
  );
  const previousDayPlan = await measure(() =>
    computePreviousDayEdits(
      dependencies.dailyRecord,
      diff,
      evidence.reportDate,
      dependencies.isAdmin
    )
  );
  const planned = { ...diff, reportEgresos: previousDayPlan.reportEgresos };
  return previousDayPlan.edits.length > 0
    ? { ...planned, previousDayEdits: previousDayPlan.edits }
    : planned;
};
