import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncMeta,
  RayenSyncSource,
} from '@/types/domain/rayenSync';

export const MAX_RAYEN_SYNC_HISTORY = 20;

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
  errors: Array<{ bedId: string }>,
  completedAt: string
): RayenSyncCoverage => {
  const failedPatients = new Set(errors.map(error => error.bedId).filter(bedId => bedId !== '*'));
  return {
    total,
    completed: Math.max(total - failedPatients.size, 0),
    errors: failedPatients.size,
    sourceErrors: errors.length,
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
