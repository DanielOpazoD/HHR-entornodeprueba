import { rayenSyncCoverageIssueKey } from './rayenSyncCoverageIssueKey';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncMeta,
  RayenSyncSource,
  RayenSyncCoverageIssue,
  RayenSyncStaffingObservation,
  RayenStaffingSection,
  RayenSyncPerformance,
  RayenSyncPolicy,
  RayenSyncReviewRequirement,
  RayenSyncStructuralReviewEvidence,
} from '@/types/domain/rayenSync';
import type { ClinicalFillError } from '../contracts/clinicalFillContracts';
import { classifyClinicalReadCause } from '../contracts/clinicalReadError';
import {
  MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE,
  MAX_RAYEN_SYNC_HISTORY,
} from '@/types/domain/rayenSync';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import {
  hasUnresolvedStaffingAmbiguity,
  NURSING_STAFFING_STANDARD_SLOTS,
} from './staffingSlotPolicy';

export { MAX_RAYEN_SYNC_HISTORY } from '@/types/domain/rayenSync';

export interface RayenSyncRun {
  id: string;
  sourceDate: string;
  startedAt: string;
  by: string;
  source?: RayenSyncSource;
  policy?: RayenSyncPolicy;
  /** Tightens `policy` for this attempt only; it can never authorize an unattended apply. */
  reviewRequirement?: RayenSyncReviewRequirement;
  performance?: RayenSyncPerformance;
}

export const upsertRayenSyncEvent = (
  history: RayenSyncEvent[] | null | undefined,
  event: RayenSyncEvent
): RayenSyncEvent[] => {
  const byId = new Map((history ?? []).map(item => [item.id, item]));
  byId.set(event.id, event);
  return Array.from(byId.values())
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, MAX_RAYEN_SYNC_HISTORY);
};

export const buildRayenSyncChanges = (diff: CensusImportDiff) => ({
  admissions: diff.summary.admissions,
  updates: diff.summary.updates,
  moves: diff.summary.moves,
  discharges: diff.summary.discharges,
  unchanged: diff.summary.unchanged,
});

const runMetadata = ({
  id,
  sourceDate,
  startedAt,
  by,
  source,
  policy,
  performance,
}: RayenSyncRun) => ({ id, sourceDate, startedAt, by, source, policy, performance });

export const buildAppliedRayenSyncEvent = (
  run: RayenSyncRun,
  diff: CensusImportDiff,
  appliedAt: string
): RayenSyncEvent => ({
  ...runMetadata(run),
  completedAt: appliedAt,
  status: 'applied',
  changes: buildRayenSyncChanges(diff),
  reviewRequirement: run.reviewRequirement,
  performance: run.performance,
});

export const buildFailedRayenSyncEvent = (
  run: RayenSyncRun,
  reason: RayenSyncFailureReason,
  completedAt: string
): RayenSyncEvent => ({
  ...runMetadata(run),
  completedAt,
  status: 'failed',
  failureReason: reason,
});

export const buildRayenSyncCoverage = (
  total: number,
  errors: ClinicalFillError[],
  completedAt: string,
  record?: DailyRecord
): RayenSyncCoverage => {
  const failedPatients = new Set(
    errors
      .filter(error => error.bedId !== '*')
      .map(error =>
        error.clinicalEpisodeId ? `episode:${error.clinicalEpisodeId}` : `bed:${error.bedId}`
      )
  );
  const issueMap = new Map<string, RayenSyncCoverageIssue>();
  errors.forEach(error => {
    // Match the exact episode in the attempt's record; never identify an old failure
    // using today's occupant of the same bed (nor a mother sharing her RN's RUN).
    const candidates = record
      ? Object.values(record.beds).flatMap(patient =>
          [patient, patient.clinicalCrib].filter(
            candidate =>
              candidate &&
              error.clinicalEpisodeId &&
              candidate.clinicalEpisodeId === error.clinicalEpisodeId
          )
        )
      : [];
    const patient = candidates.length === 1 ? candidates[0] : undefined;
    const issue: RayenSyncCoverageIssue = {
      bedId: error.bedId,
      source: error.source,
      reason: error.reason,
      ...(error.reason === 'source_unavailable' || error.reason === 'source_timeout'
        ? { cause: classifyClinicalReadCause(error.message) }
        : {}),
      ...(error.source === 'cudyr' && error.cudyrRecovery
        ? { cudyrRecovery: error.cudyrRecovery }
        : {}),
      ...(record
        ? {
            diagnostic: {
              censusDate: record.date,
              bedId: error.bedId.slice(0, 80),
              clinicalEpisodeId: (error.clinicalEpisodeId ?? '').slice(0, 100),
              ...(patient
                ? {
                    patientName: patient.patientName.slice(0, 240),
                    document: (patient.rut ?? '').slice(0, 80),
                  }
                : {}),
            },
          }
        : {}),
    };
    issueMap.set(rayenSyncCoverageIssueKey(issue, error.clinicalEpisodeId), issue);
  });
  return {
    total,
    completed: Math.max(total - failedPatients.size, 0),
    errors: failedPatients.size,
    sourceErrors: errors.length,
    ...(issueMap.size > 0 ? { issues: [...issueMap.values()].slice(0, 12) } : {}),
    completedAt,
  };
};

const STAFFING_SECTIONS: ReadonlyArray<{
  key: keyof Pick<NursingStaffingProposal, 'day' | 'night' | 'tensDay' | 'tensNight'>;
  code: RayenStaffingSection;
  slots: number;
}> = [
  { key: 'day', code: 'nurse_day', slots: NURSING_STAFFING_STANDARD_SLOTS.day },
  { key: 'night', code: 'nurse_night', slots: NURSING_STAFFING_STANDARD_SLOTS.night },
  { key: 'tensDay', code: 'tens_day', slots: NURSING_STAFFING_STANDARD_SLOTS.tensDay },
  { key: 'tensNight', code: 'tens_night', slots: NURSING_STAFFING_STANDARD_SLOTS.tensNight },
];

export const buildRayenStaffingObservation = (
  proposal?: NursingStaffingProposal | null
): RayenSyncStaffingObservation | undefined => {
  if (!proposal) return undefined;
  const ambiguousSections: RayenStaffingSection[] = [];
  let ignoredBoundaryRecords = 0;
  const ignoredBoundaryEvidence = new Map<
    string,
    NonNullable<RayenSyncStaffingObservation['ignoredBoundaryEvidence']>[number]
  >();
  for (const section of STAFFING_SECTIONS) {
    const suggestion = proposal[section.key];
    if (!suggestion) continue;
    if (hasUnresolvedStaffingAmbiguity(suggestion, section.slots)) {
      ambiguousSections.push(section.code);
    }
    ignoredBoundaryRecords += suggestion.ignoredBoundaryRecords;
    for (const evidence of suggestion.ignoredBoundaryEvidence ?? []) {
      const item = { ...evidence, section: section.code };
      const key = [
        item.section,
        item.name,
        item.role,
        item.recordedAt,
        item.source,
        item.boundary,
      ].join('|');
      if (ignoredBoundaryEvidence.size < MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE) {
        ignoredBoundaryEvidence.set(key, item);
      }
    }
  }
  if (ambiguousSections.length === 0 && ignoredBoundaryRecords === 0) return undefined;
  return {
    ambiguousSections,
    ignoredBoundaryRecords,
    ignoredBoundaryEvidence: [...ignoredBoundaryEvidence.values()],
  };
};

export const completeRayenSyncEvent = (
  event: RayenSyncEvent,
  coverage: RayenSyncCoverage,
  staffingObservation?: RayenSyncStaffingObservation,
  performance?: RayenSyncPerformance,
  structuralReview?: RayenSyncStructuralReviewEvidence
): RayenSyncEvent => ({
  ...event,
  completedAt: coverage.completedAt,
  status:
    coverage.sourceErrors > 0 ||
    structuralReview?.historicalCorrectionsPending === true ||
    structuralReview?.historicalCorrectionsRequireFreshCapture === true ||
    (structuralReview?.isolatedConflicts ?? 0) > 0 ||
    (event.source?.gestionCamas != null && event.source.gestionCamas !== 'ready')
      ? 'partial'
      : 'complete',
  coverage,
  staffingObservation,
  structuralReview,
  performance: performance ?? event.performance,
  failureReason: undefined,
});

export const rayenSyncMetaFromEvent = (event: RayenSyncEvent): RayenSyncMeta => ({
  at: event.startedAt,
  by: event.by,
  runId: event.id,
  status: event.status === 'failed' ? 'applied' : event.status,
  coverage: event.coverage,
  changes: event.changes,
  source: event.source,
  staffingObservation: event.staffingObservation,
});

export const rayenSyncChangeCount = (event: RayenSyncEvent): number => {
  const changes = event.changes;
  return changes ? changes.admissions + changes.updates + changes.moves + changes.discharges : 0;
};
