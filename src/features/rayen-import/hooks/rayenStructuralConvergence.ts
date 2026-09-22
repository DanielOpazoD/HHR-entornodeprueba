import type { CensusImportDiff, ConflictEntry } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenSyncExecutionIdentity } from './rayenSyncExecutionState';
import { defaultMonotonicNow, elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import {
  normalizeOfficialPatientIdentifier as normalizeRut,
  officialPatientTypedIdentitiesEqual,
} from '../domain/officialPatientIdentifier';

export interface RayenStructuralReplan extends RayenSyncExecutionIdentity {
  requestId: string;
  selectedDate: string;
  clinicalDay: string;
  /** Aggregate-only marker used to separate human review from active processing. */
  reviewStartedAtMs?: number;
  replan: (record: DailyRecord) => Promise<CensusImportDiff>;
}

export const startRayenStructuralReviewTiming = (
  plan: RayenStructuralReplan,
  now: () => number = defaultMonotonicNow
): RayenStructuralReplan => ({ ...plan, reviewStartedAtMs: now() });

export const consumeRayenStructuralReviewTiming = (
  plan: RayenStructuralReplan,
  now: () => number = defaultMonotonicNow
): { plan: RayenStructuralReplan; durationMs: number | null } => {
  if (plan.reviewStartedAtMs == null) return { plan, durationMs: null };
  const { reviewStartedAtMs, ...unmeasuredPlan } = plan;
  return {
    plan: unmeasuredPlan,
    durationMs: elapsedMilliseconds(reviewStartedAtMs, now()),
  };
};

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
  rut?: string;
  documentType?: ConflictEntry['documentType'];
  clinicalEpisodeId?: string;
  scope?: ConflictEntry['scope'];
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
    rut: normalizeRut(conflict.rut),
    documentType: conflict.documentType,
    clinicalEpisodeId: episodeIdFromConflict(conflict),
    scope: conflict.scope,
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
  // Only report-row identity conflicts carry explicit subject scope. Every other conflict without
  // an episode or bed remains global: authority outages and unknown structural failures must keep
  // the whole clinical stage blocked instead of guessing which patients are unaffected.
  if (
    conflicts.some(
      conflict =>
        !conflict.clinicalEpisodeId &&
        !conflict.bedId &&
        !(conflict.scope === 'report-row-subject' && normalizeRut(conflict.rut))
    )
  )
    return [];
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
  const blockedSubjects = conflicts.filter(
    conflict => conflict.scope === 'report-row-subject' && normalizeRut(conflict.rut)
  );
  const subjectIsBlocked = (rut?: string, documentType?: ConflictEntry['documentType']): boolean =>
    blockedSubjects.some(conflict =>
      conflict.documentType && documentType
        ? officialPatientTypedIdentitiesEqual(
            conflict.rut,
            conflict.documentType,
            rut,
            documentType
          )
        : normalizeRut(conflict.rut) === normalizeRut(rut)
    );
  for (const patient of Object.values(record.beds)) {
    if (subjectIsBlocked(patient?.rut, patient?.documentType) && patient?.clinicalEpisodeId) {
      blockedEpisodes.add(patient.clinicalEpisodeId);
    }
    if (
      subjectIsBlocked(patient?.clinicalCrib?.rut, patient?.clinicalCrib?.documentType) &&
      patient?.clinicalCrib?.clinicalEpisodeId
    ) {
      blockedEpisodes.add(patient.clinicalCrib.clinicalEpisodeId);
    }
  }
  return collectRecordClinicalEpisodeIds(record).filter(
    episodeId => !blockedEpisodes.has(episodeId)
  );
};
