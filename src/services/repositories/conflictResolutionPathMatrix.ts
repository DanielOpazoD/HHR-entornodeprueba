import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import {
  decideScalarByPolicy,
  isClinicalCensusRemotePriorityField,
  isLocalNarrativePatientField,
} from '@/services/repositories/conflictResolutionPolicy';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import {
  ConflictResolutionTraceContext,
  traceFromScalarDecision,
} from '@/services/repositories/conflictResolutionTrace';
import {
  PATIENT_ID_ARRAY_FIELDS,
  PATIENT_UNIQUE_ARRAY_FIELDS,
  mergeArrayById,
  mergePatientData,
} from '@/services/repositories/conflictResolutionMergeUtils';
import {
  shouldPreserveLocalPatientNarrative,
  shouldUseRemoteEpisodeScopedValue,
} from '@/services/repositories/patientEpisodeNarrativePolicy';
import { mergePatientDevices } from '@/services/repositories/conflictResolutionDeviceMergeUtils';
import {
  EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS,
  isSameEpisodeForExplicitCensusPatch,
} from '@/services/repositories/explicitLocalCensusPatchPolicy';
import { isSameIdentityUnderReview } from '@/shared/census/patientIdentityReview';

export const resolvePathValueWithMatrix = (
  remote: DailyRecord,
  local: DailyRecord,
  path: string,
  traceContext: ConflictResolutionTraceContext
): unknown => {
  const parts = path.split('.');
  const bedId = parts[1];
  // The newborn crib is a slot of its own, with the rules of a bed: its own identity decides.
  const crib = parts[2] === 'clinicalCrib';
  const patientField = parts[crib ? 3 : 2];
  const slotPath = crib ? `beds.${bedId}.clinicalCrib` : `beds.${bedId}`;
  const remoteSlot = getValueAtPath(remote, slotPath) as PatientData | undefined;
  const localSlot = getValueAtPath(local, slotPath) as PatientData | undefined;

  if (crib && !patientField) {
    // A whole crib merges like a whole bed.
    return remoteSlot || localSlot
      ? mergePatientData(remoteSlot, localSlot, true, traceContext, path, true)
      : undefined;
  }

  if (!bedId || !patientField) {
    const decision = decideScalarByPolicy(
      path,
      getValueAtPath(remote, path),
      getValueAtPath(local, path),
      true
    );
    traceContext.add(traceFromScalarDecision(path, decision));
    return decision.value;
  }

  // A field the stored day cannot read shows only a placeholder there: the same patient's repair
  // of it wins.
  if (
    remoteSlot &&
    localSlot &&
    (remoteSlot.identityReview?.fields as readonly string[] | undefined)?.includes(patientField) &&
    isSameIdentityUnderReview(remoteSlot, localSlot)
  ) {
    return getValueAtPath(local, path);
  }

  if (EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS.has(patientField)) {
    if (isSameEpisodeForExplicitCensusPatch(remoteSlot, localSlot)) {
      traceContext.add({
        path,
        strategy: 'copy_local_value',
        winner: 'local',
        reason: 'explicit_local_census_patch_same_episode',
      });
      return getValueAtPath(local, path);
    }
    traceContext.add({
      path,
      strategy: 'copy_remote_value',
      winner: 'remote',
      reason: 'explicit_local_census_patch_different_episode',
    });
    return getValueAtPath(remote, path);
  }

  if (isClinicalCensusRemotePriorityField(patientField)) {
    const decision = decideScalarByPolicy(
      path,
      getValueAtPath(remote, path),
      getValueAtPath(local, path),
      true
    );
    traceContext.add(traceFromScalarDecision(path, decision));
    return decision.value;
  }

  if (
    isLocalNarrativePatientField(patientField) &&
    !shouldPreserveLocalPatientNarrative(remoteSlot, localSlot)
  ) {
    traceContext.add({
      path,
      strategy: 'scalar_policy',
      winner: 'remote',
      reason: 'remote_episode_prevents_stale_local_narrative',
    });
    return getValueAtPath(remote, path);
  }

  if (shouldUseRemoteEpisodeScopedValue(patientField, remoteSlot, localSlot)) {
    traceContext.add({
      path,
      strategy: 'copy_remote_value',
      winner: 'remote',
      reason: 'remote_episode_prevents_stale_local_structured_narrative',
    });
    return getValueAtPath(remote, path);
  }

  if (PATIENT_ID_ARRAY_FIELDS.has(patientField)) {
    return mergeArrayById(
      getValueAtPath(remote, path) as unknown[],
      getValueAtPath(local, path) as unknown[],
      traceContext,
      path
    );
  }

  if (PATIENT_UNIQUE_ARRAY_FIELDS.has(patientField)) {
    return mergePatientDevices(
      (getValueAtPath(remote, path) as string[]) || [],
      (getValueAtPath(local, path) as string[]) || [],
      getValueAtPath(local, `${slotPath}.deviceDetails`) as
        | Record<string, { removalDate?: unknown }>
        | undefined,
      getValueAtPath(local, `${slotPath}.deviceInstanceHistory`) as
        | Array<{ type?: unknown; status?: unknown; removalDate?: unknown }>
        | undefined,
      true,
      traceContext,
      path,
      true
    );
  }

  const decision = decideScalarByPolicy(
    path,
    getValueAtPath(remote, path),
    getValueAtPath(local, path),
    true
  );
  traceContext.add(traceFromScalarDecision(path, decision));
  return decision.value;
};

// Kept with the path rules it mirrors: the shell chunk carries it for both of its lazy users.
export { findDetachedReviewEdits } from '@/services/repositories/conflictResolutionDetachedEdits';
