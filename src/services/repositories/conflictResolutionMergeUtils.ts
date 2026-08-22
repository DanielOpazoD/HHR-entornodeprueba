import { PatientData } from '@/services/contracts/patientServiceContracts';
import { resolveConflictDomainContextForPath } from '@/services/repositories/conflictResolutionDomainPolicy';
import {
  decideScalarByPolicy,
  isClinicalCensusRemotePriorityField,
  isLocalNarrativePatientField,
} from '@/services/repositories/conflictResolutionPolicy';
import {
  hasPatientIdentityOrClinicalContent,
  isLocallyClearedPatient,
  shouldPreserveLocalPatientNarrative,
  shouldUseRemoteEpisodeScopedValue,
} from '@/services/repositories/patientEpisodeNarrativePolicy';
import { isPlainObject, isPrimitive } from '@/services/repositories/conflictResolutionUtils';
import {
  mergePatientDevices,
  type DeviceDetailsLike,
  type DeviceHistoryLike,
} from '@/services/repositories/conflictResolutionDeviceMergeUtils';
import {
  ConflictResolutionTraceContext,
  traceFromScalarDecision,
} from '@/services/repositories/conflictResolutionTrace';
import {
  filterDeviceDetailsToActiveOrRetired,
  shouldKeepExplicitLocalCensusValue,
} from '@/services/repositories/conflictResolutionPatientMergeGuards';

export const ID_BASED_ARRAY_FIELDS = new Set([
  'discharges',
  'transfers',
  'cma',
  'rayenBedCollisionResolutions',
]);
export const UNIQUE_ARRAY_FIELDS = new Set(['activeExtraBeds']);
export const PATIENT_ID_ARRAY_FIELDS = new Set([
  'clinicalEvents',
  'deviceInstanceHistory',
  'medicalHandoffEntries',
]);
export const PATIENT_UNIQUE_ARRAY_FIELDS = new Set(['devices']);

const resolveItemId = (item: unknown): string => {
  if (item && typeof item === 'object' && 'id' in item) {
    return String((item as { id?: string | number }).id ?? JSON.stringify(item));
  }
  return JSON.stringify(item);
};

const resolveArrayMergeReason = (path: string): string => {
  const context = resolveConflictDomainContextForPath(path);
  if (context === 'movements') {
    return 'movements_union_preserve_local_override';
  }
  return 'union_preserve_local_override';
};

const resolveUniqueArrayMergeReason = (path: string, preferLocal: boolean): string => {
  const context = resolveConflictDomainContextForPath(path);
  if (context === 'staffing') {
    return preferLocal ? 'staffing_union_prefer_local_order' : 'staffing_union_prefer_remote_order';
  }
  return preferLocal ? 'union_prefer_local_order' : 'union_prefer_remote_order';
};

const resolveObjectMergeReason = (path: string): string => {
  const context = resolveConflictDomainContextForPath(path);
  if (context === 'handoff') {
    return 'handoff_merge_object_fields';
  }
  return 'merge_object_fields';
};

export const mergeArrayById = <T>(
  remote: T[] = [],
  local: T[] = [],
  traceContext?: ConflictResolutionTraceContext,
  path = ''
): T[] => {
  const output = new Map<string, T>();
  const sequence: string[] = [];

  const append = (item: T) => {
    const id = resolveItemId(item);
    if (!output.has(id)) {
      sequence.push(id);
    }
    output.set(id, item);
  };

  remote.forEach(append);
  local.forEach(append);

  traceContext?.add({
    path,
    strategy: 'merge_array_by_id',
    winner: 'merged',
    reason: resolveArrayMergeReason(path),
  });

  return sequence.map(id => output.get(id) as T);
};

export const mergeUniquePrimitiveArray = (
  remote: string[] = [],
  local: string[] = [],
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  path = ''
): string[] => {
  const preferred = preferLocal ? local : remote;
  const secondary = preferLocal ? remote : local;
  traceContext?.add({
    path,
    strategy: 'merge_unique_primitive_array',
    winner: 'merged',
    reason: resolveUniqueArrayMergeReason(path, preferLocal),
  });
  return Array.from(new Set([...(preferred || []), ...(secondary || [])]));
};

export const mergeUnknown = (
  remote: unknown,
  local: unknown,
  preferLocal: boolean,
  path = '',
  traceContext?: ConflictResolutionTraceContext
): unknown => {
  if (Array.isArray(remote) || Array.isArray(local)) {
    const remoteArray = Array.isArray(remote) ? remote : [];
    const localArray = Array.isArray(local) ? local : [];
    if (remoteArray.length > 0 && typeof remoteArray[0] === 'object') {
      return mergeArrayById(remoteArray, localArray, traceContext, path);
    }
    return mergeUniquePrimitiveArray(
      remoteArray.filter(isPrimitive).map(String),
      localArray.filter(isPrimitive).map(String),
      preferLocal,
      traceContext,
      path
    );
  }

  if (isPlainObject(remote) || isPlainObject(local)) {
    return mergeObject(
      (isPlainObject(remote) ? remote : {}) as Record<string, unknown>,
      (isPlainObject(local) ? local : {}) as Record<string, unknown>,
      preferLocal,
      traceContext,
      path
    );
  }
  const decision = decideScalarByPolicy(path, remote, local, preferLocal);
  traceContext?.add(traceFromScalarDecision(path, decision));
  return decision.value;
};

export const mergeObject = (
  remote: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  pathPrefix = ''
): Record<string, unknown> | undefined => {
  if (!remote && !local) return undefined;
  if (!remote) return local;
  if (!local) return remote;

  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
  traceContext?.add({
    path: pathPrefix || '*',
    strategy: 'merge_object',
    winner: 'merged',
    reason: resolveObjectMergeReason(pathPrefix || '*'),
  });

  keys.forEach(key => {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    result[key] = mergeUnknown(remote[key], local[key], preferLocal, childPath, traceContext);
  });

  return result;
};

export const mergePatientData = (
  remotePatient: PatientData | undefined,
  localPatient: PatientData | undefined,
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  pathPrefix = 'beds',
  // True when the caller knows this specific bed was explicitly modified
  // locally (e.g. came from `resolveByChangedPaths` with a `beds.<id>` path
  // in `changedPaths`). False when merging a whole record where we cannot
  // distinguish "intentionally cleared by user" from "never touched, just
  // the bootstrap default". Without this flag the "preserve local clear"
  // branch would silently drop legitimate concurrent updates from another
  // user/tab on beds that the local actor never edited (issue #16).
  isExplicitlyChangedPath = false
): PatientData => {
  if (!remotePatient && localPatient) {
    traceContext?.add({
      path: pathPrefix,
      strategy: 'copy_local_value',
      winner: 'local',
      reason: 'remote_patient_missing',
    });
    return localPatient;
  }
  if (!localPatient && remotePatient) {
    traceContext?.add({
      path: pathPrefix,
      strategy: 'copy_local_value',
      winner: 'remote',
      reason: 'local_patient_missing',
    });
    return remotePatient;
  }
  if (!remotePatient && !localPatient) {
    return {} as PatientData;
  }

  if (
    preferLocal &&
    isExplicitlyChangedPath &&
    isLocallyClearedPatient(localPatient) &&
    hasPatientIdentityOrClinicalContent(remotePatient)
  ) {
    traceContext?.add({
      path: pathPrefix,
      strategy: 'copy_local_value',
      winner: 'local',
      reason: 'intentional_local_bed_clear',
    });
    return localPatient as PatientData;
  }

  if (
    preferLocal &&
    hasPatientIdentityOrClinicalContent(localPatient) &&
    !hasPatientIdentityOrClinicalContent(remotePatient)
  ) {
    traceContext?.add({
      path: pathPrefix,
      strategy: 'copy_local_value',
      winner: 'local',
      reason: 'local_patient_replacement',
    });
    return localPatient as PatientData;
  }

  const remoteRecord = remotePatient as unknown as Record<string, unknown>;
  const localRecord = localPatient as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(remoteRecord), ...Object.keys(localRecord)]);
  const preserveLocalNarrative = shouldPreserveLocalPatientNarrative(remotePatient, localPatient);
  traceContext?.add({
    path: pathPrefix,
    strategy: 'merge_patient',
    winner: 'merged',
    reason: 'clinical_merge_patient_fields',
  });

  keys.forEach(key => {
    const remoteValue = remoteRecord[key];
    const localValue = localRecord[key];

    if (
      shouldKeepExplicitLocalCensusValue(key, remotePatient, localPatient, remoteValue, localValue)
    ) {
      merged[key] = localValue;
      traceContext?.add({
        path: `${pathPrefix}.${key}`,
        strategy: 'copy_local_value',
        winner: 'local',
        reason: 'explicit_local_census_patch_same_episode',
      });
      return;
    }

    if (isClinicalCensusRemotePriorityField(key)) {
      const decision = decideScalarByPolicy(
        `${pathPrefix}.${key}`,
        remoteValue,
        localValue,
        preferLocal
      );
      merged[key] = decision.value;
      traceContext?.add(traceFromScalarDecision(`${pathPrefix}.${key}`, decision));
      return;
    }

    if (isLocalNarrativePatientField(key) && !preserveLocalNarrative) {
      merged[key] = remoteValue;
      traceContext?.add({
        path: `${pathPrefix}.${key}`,
        strategy: 'scalar_policy',
        winner: 'remote',
        reason: 'remote_episode_prevents_stale_local_narrative',
      });
      return;
    }

    if (shouldUseRemoteEpisodeScopedValue(key, remotePatient, localPatient)) {
      merged[key] = remoteValue;
      traceContext?.add({
        path: `${pathPrefix}.${key}`,
        strategy: 'copy_remote_value',
        winner: 'remote',
        reason: 'remote_episode_prevents_stale_local_structured_narrative',
      });
      return;
    }

    if (PATIENT_ID_ARRAY_FIELDS.has(key)) {
      merged[key] = mergeArrayById(
        (remoteValue as unknown[]) || [],
        (localValue as unknown[]) || [],
        traceContext,
        `${pathPrefix}.${key}`
      );
      return;
    }

    if (PATIENT_UNIQUE_ARRAY_FIELDS.has(key)) {
      merged[key] = mergePatientDevices(
        (remoteValue as string[]) || [],
        (localValue as string[]) || [],
        localRecord.deviceDetails as DeviceDetailsLike | undefined,
        localRecord.deviceInstanceHistory as DeviceHistoryLike | undefined,
        preferLocal,
        traceContext,
        `${pathPrefix}.${key}`,
        isExplicitlyChangedPath
      );
      return;
    }

    if (key === 'clinicalCrib') {
      merged[key] = mergePatientData(
        remoteValue as PatientData | undefined,
        localValue as PatientData | undefined,
        preferLocal,
        traceContext,
        `${pathPrefix}.${key}`,
        isExplicitlyChangedPath
      );
      return;
    }

    merged[key] = mergeUnknown(
      remoteValue,
      localValue,
      preferLocal,
      `${pathPrefix}.${key}`,
      traceContext
    );
  });

  filterDeviceDetailsToActiveOrRetired(merged);

  return merged as unknown as PatientData;
};

export const mergeBeds = (
  remoteBeds: Record<string, PatientData>,
  localBeds: Record<string, PatientData>,
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  pathPrefix = 'beds',
  // Forwarded to `mergePatientData` for every bed in this merge. Pass `true`
  // only when the caller knows every bed under `pathPrefix` was explicitly
  // edited locally (e.g. `resolveByChangedPaths` with a `'beds'` root path).
  // Default `false` keeps the safe whole-record semantics where we cannot
  // tell intentional clears apart from untouched bootstrap defaults.
  isExplicitlyChangedPath = false
): Record<string, PatientData> => {
  const merged: Record<string, PatientData> = {};
  const bedIds = new Set([...Object.keys(remoteBeds || {}), ...Object.keys(localBeds || {})]);
  traceContext?.add({
    path: pathPrefix,
    strategy: 'merge_beds',
    winner: 'merged',
    reason: 'clinical_merge_union_by_bed_id',
  });

  bedIds.forEach(bedId => {
    merged[bedId] = mergePatientData(
      remoteBeds?.[bedId],
      localBeds?.[bedId],
      preferLocal,
      traceContext,
      `beds.${bedId}`,
      isExplicitlyChangedPath
    );
  });

  return merged;
};
