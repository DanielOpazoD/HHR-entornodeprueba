import type { RayenCensusSnapshot, RayenCaptureTimings } from '../contracts/rayenSnapshot';
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
  dualCaptureMs: number,
  captureTimings?: RayenCaptureTimings
): RayenSyncPerformanceDelta => {
  const stagesMs: RayenSyncPerformanceDelta['stagesMs'] = { dualCapture: dualCaptureMs };
  // Diagnostics are optional. Discard invalid/unknown values without blocking clinical evidence.
  for (const key of [
    'captureHealthBefore',
    'captureFichaMedico',
    'fichaContext',
    'fichaListsAndCatalog',
    'fichaPatientReads',
    'fichaDiagnosisCoding',
    'captureGestionCamas',
    'captureHealthAfter',
  ] as const) {
    const duration = captureTimings?.[key];
    if (typeof duration === 'number' && Number.isSafeInteger(duration) && duration >= 0) {
      stagesMs[key] = duration;
    }
  }
  return {
    stagesMs,
    sourceQuality: { treatingPhysicians: summarizeTreatingPhysicianSourceQuality(source, planned) },
  };
};
