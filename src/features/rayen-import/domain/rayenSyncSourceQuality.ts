import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import type {
  RayenSyncPerformanceDelta,
  RayenTreatingPhysicianSourceQuality,
} from '@/types/domain/rayenSync';

const hasText = (value?: string): boolean => Boolean(value?.trim());

/** Aggregate-only contract evidence; deliberately excludes identities and clinical values. */
export const summarizeTreatingPhysicianSourceQuality = (
  source: RayenCensusSnapshot,
  planned: RayenCensusSnapshot
): RayenTreatingPhysicianSourceQuality => ({
  encounters: source.encounters.length,
  catalogEntries: source.physicians?.length ?? 0,
  assignedEncounters: source.encounters.filter(item => hasText(item.treatingPhysicianId)).length,
  sourceResolvedNames: source.encounters.filter(
    item => hasText(item.treatingPhysicianId) && hasText(item.treatingPhysicianName)
  ).length,
  plannedResolvedNames: planned.encounters.filter(
    item => hasText(item.treatingPhysicianId) && hasText(item.treatingPhysicianName)
  ).length,
});

export const buildRayenCapturePerformance = (
  source: RayenCensusSnapshot,
  planned: RayenCensusSnapshot,
  dualCaptureMs: number
): RayenSyncPerformanceDelta => ({
  stagesMs: { dualCapture: dualCaptureMs },
  sourceQuality: {
    treatingPhysicians: summarizeTreatingPhysicianSourceQuality(source, planned),
  },
});
