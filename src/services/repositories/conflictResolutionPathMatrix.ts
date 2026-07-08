import type { DailyRecord } from '@/types/domain/dailyRecord';
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

export const resolvePathValueWithMatrix = (
  remote: DailyRecord,
  local: DailyRecord,
  path: string,
  traceContext: ConflictResolutionTraceContext
): unknown => {
  const parts = path.split('.');
  const bedId = parts[1];
  const patientField = parts[2];

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

  if (EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS.has(patientField)) {
    if (isSameEpisodeForExplicitCensusPatch(remote.beds[bedId], local.beds[bedId])) {
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
    !shouldPreserveLocalPatientNarrative(remote.beds[bedId], local.beds[bedId])
  ) {
    traceContext.add({
      path,
      strategy: 'scalar_policy',
      winner: 'remote',
      reason: 'remote_episode_prevents_stale_local_narrative',
    });
    return getValueAtPath(remote, path);
  }

  if (shouldUseRemoteEpisodeScopedValue(patientField, remote.beds[bedId], local.beds[bedId])) {
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
      getValueAtPath(local, `beds.${bedId}.deviceDetails`) as
        | Record<string, { removalDate?: unknown }>
        | undefined,
      getValueAtPath(local, `beds.${bedId}.deviceInstanceHistory`) as
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
