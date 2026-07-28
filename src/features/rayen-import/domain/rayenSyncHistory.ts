import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncMeta,
  RayenSyncSource,
  RayenSyncCoverageIssue,
  RayenSyncIssueReason,
  RayenSyncStaffingObservation,
  RayenStaffingSection,
  RayenSyncPerformance,
} from '@/types/domain/rayenSync';
import {
  MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE,
  MAX_RAYEN_SYNC_HISTORY,
} from '@/types/domain/rayenSync';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';

export { MAX_RAYEN_SYNC_HISTORY } from '@/types/domain/rayenSync';

export interface RayenSyncRun {
  id: string;
  startedAt: string;
  by: string;
  source?: RayenSyncSource;
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

export const buildAppliedRayenSyncEvent = (
  run: RayenSyncRun,
  diff: CensusImportDiff,
  appliedAt: string
): RayenSyncEvent => ({
  id: run.id,
  startedAt: run.startedAt,
  completedAt: appliedAt,
  by: run.by,
  status: 'applied',
  changes: buildRayenSyncChanges(diff),
  source: run.source,
  performance: run.performance,
});

export const buildFailedRayenSyncEvent = (
  run: RayenSyncRun,
  reason: RayenSyncFailureReason,
  completedAt: string
): RayenSyncEvent => ({
  id: run.id,
  startedAt: run.startedAt,
  completedAt,
  by: run.by,
  status: 'failed',
  source: run.source,
  performance: run.performance,
  failureReason: reason,
});

export const buildRayenSyncCoverage = (
  total: number,
  errors: Array<{ bedId: string; source?: string; message?: string }>,
  completedAt: string
): RayenSyncCoverage => {
  const failedPatients = new Set(errors.map(error => error.bedId).filter(bedId => bedId !== '*'));
  const issueReason = (
    error: (typeof errors)[number],
    source: RayenSyncCoverageIssue['source']
  ): RayenSyncIssueReason => {
    const detail = String(error.message || '').toLowerCase();
    if (detail.includes('modificado por otro usuario') || detail.includes('concurrencyerror')) {
      return 'concurrent_write';
    }
    if (detail.includes('no se pudo archivar el cudyr')) return 'historical_archive_failed';
    if (detail.includes('clinical_fill_busy')) return 'sync_already_running';
    if (detail.includes('timeout') || detail.includes('tiempo de espera')) return 'source_timeout';
    if (source === 'patch') {
      return detail.includes('unexpected') ? 'unexpected' : 'write_failed';
    }
    return detail.includes('unexpected') ? 'unexpected' : 'source_unavailable';
  };
  const issueMap = new Map<string, RayenSyncCoverageIssue>();
  errors.forEach(error => {
    const source = ['devices', 'scales', 'vitals', 'staffing', 'cudyr', 'patch'].includes(
      error.source ?? ''
    )
      ? (error.source as RayenSyncCoverageIssue['source'])
      : 'patch';
    const issue: RayenSyncCoverageIssue = {
      bedId: error.bedId,
      source,
      reason: issueReason(error, source),
    };
    issueMap.set(`${issue.bedId}:${issue.source}:${issue.reason}`, issue);
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
}> = [
  { key: 'day', code: 'nurse_day' },
  { key: 'night', code: 'nurse_night' },
  { key: 'tensDay', code: 'tens_day' },
  { key: 'tensNight', code: 'tens_night' },
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
    if (suggestion.ambiguous) ambiguousSections.push(section.code);
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
  performance?: RayenSyncPerformance
): RayenSyncEvent => ({
  ...event,
  completedAt: coverage.completedAt,
  status:
    coverage.sourceErrors > 0 ||
    (event.source?.gestionCamas != null && event.source.gestionCamas !== 'ready')
      ? 'partial'
      : 'complete',
  coverage,
  staffingObservation,
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
