import type { CensusImportDiff, ConflictEntry } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenSyncExecutionIdentity } from './rayenSyncExecutionState';

export interface RayenStructuralReplan extends RayenSyncExecutionIdentity {
  requestId: string;
  selectedDate: string;
  clinicalDay: string;
  replan: (record: DailyRecord) => Promise<CensusImportDiff>;
}

export const matchesRayenStructuralReplan = (
  plan: RayenStructuralReplan | null | undefined,
  identity: RayenSyncExecutionIdentity
): plan is RayenStructuralReplan =>
  Boolean(
    plan &&
    plan.runId === identity.runId &&
    plan.requestId === identity.requestId &&
    plan.selectedDate === identity.selectedDate
  );

export interface StructuralConflict {
  bedId: string | null;
  clinicalEpisodeId?: string;
  code?: ConflictEntry['code'];
  reason: string;
}

const episodeIdFromConflict = (conflict: ConflictEntry): string | undefined =>
  conflict.source?.encounterId ??
  conflict.blockedAdmission?.patient.clinicalEpisodeId ??
  conflict.blockedAdmission?.source?.encounterId ??
  conflict.blockedMove?.source.encounterId;

export const describeStructuralConflicts = (
  conflicts: readonly ConflictEntry[]
): StructuralConflict[] =>
  conflicts.map(conflict => ({
    bedId: conflict.bedId,
    clinicalEpisodeId: episodeIdFromConflict(conflict),
    code: conflict.code,
    reason: conflict.reason,
  }));

export const collectRecordClinicalEpisodeIds = (record: DailyRecord): string[] => {
  const episodes = new Set<string>();
  for (const patient of Object.values(record.beds)) {
    if (patient?.clinicalEpisodeId) episodes.add(patient.clinicalEpisodeId);
    if (patient?.clinicalCrib?.clinicalEpisodeId) {
      episodes.add(patient.clinicalCrib.clinicalEpisodeId);
    }
  }
  return [...episodes];
};

export const collectSafeClinicalEpisodeIds = (
  record: DailyRecord,
  conflicts: readonly StructuralConflict[]
): string[] => {
  // A conflict without an episode or bed cannot be isolated safely. Keep the whole clinical stage
  // blocked instead of guessing which patients are unaffected.
  if (conflicts.some(conflict => !conflict.clinicalEpisodeId && !conflict.bedId)) return [];
  const blockedEpisodes = new Set(
    conflicts.flatMap(conflict => (conflict.clinicalEpisodeId ? [conflict.clinicalEpisodeId] : []))
  );
  const blockedBeds = new Set(
    conflicts.flatMap(conflict => (conflict.bedId ? [conflict.bedId] : []))
  );
  for (const bedId of blockedBeds) {
    const patient = record.beds[bedId];
    if (patient?.clinicalEpisodeId) blockedEpisodes.add(patient.clinicalEpisodeId);
    if (patient?.clinicalCrib?.clinicalEpisodeId) {
      blockedEpisodes.add(patient.clinicalCrib.clinicalEpisodeId);
    }
  }
  return collectRecordClinicalEpisodeIds(record).filter(
    episodeId => !blockedEpisodes.has(episodeId)
  );
};
