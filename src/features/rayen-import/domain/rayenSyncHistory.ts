import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncMeta,
  RayenSyncSource,
  RayenSyncCoverageIssue,
  RayenSyncIssueReason,
} from '@/types/domain/rayenSync';
import { MAX_RAYEN_SYNC_HISTORY } from '@/types/domain/rayenSync';

export { MAX_RAYEN_SYNC_HISTORY } from '@/types/domain/rayenSync';

export interface RayenSyncRun {
  id: string;
  startedAt: string;
  by: string;
  source?: RayenSyncSource;
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
    const source = ['devices', 'scales', 'vitals', 'cudyr', 'patch'].includes(error.source ?? '')
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

export const completeRayenSyncEvent = (
  event: RayenSyncEvent,
  coverage: RayenSyncCoverage
): RayenSyncEvent => ({
  ...event,
  completedAt: coverage.completedAt,
  status:
    coverage.sourceErrors > 0 ||
    (event.source?.gestionCamas != null && event.source.gestionCamas !== 'ready')
      ? 'partial'
      : 'complete',
  coverage,
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
});

export const rayenSyncChangeCount = (event: RayenSyncEvent): number => {
  const changes = event.changes;
  return changes ? changes.admissions + changes.updates + changes.moves + changes.discharges : 0;
};
