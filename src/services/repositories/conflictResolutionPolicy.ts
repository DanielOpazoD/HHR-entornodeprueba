import { resolveConflictDomainContextForPath } from '@/services/repositories/conflictResolutionDomainPolicy';
import { hasPatientFieldSyncOwnership } from '@/services/repositories/dailyRecordSyncOwnershipPolicy';

const ROOT_LOCAL_PRIORITY_FIELDS = new Set([
  'handoffNovedadesDayShift',
  'handoffNovedadesNightShift',
  'medicalHandoffGlobalNote',
]);

export const CONFLICT_RESOLUTION_POLICY_VERSION = '2026-03-v3';

export interface ScalarPolicyDecision {
  value: unknown;
  winner: 'local' | 'remote';
  reason:
    | 'local_undefined_fallback'
    | 'remote_undefined_fallback'
    | 'root_local_priority'
    | 'root_remote_priority'
    | 'clinical_census_remote_priority'
    | 'clinical_local_priority'
    | 'clinical_remote_non_empty_fallback'
    | 'admin_remote_priority'
    | 'staffing_local_priority'
    | 'handoff_local_priority'
    | 'metadata_remote_priority'
    | 'default_local_priority'
    | 'default_remote_priority';
}

const ROOT_REMOTE_PRIORITY_FIELDS = new Set(['dateTimestamp', 'schemaVersion']);

export const isClinicalCensusRemotePriorityField = (field: string): boolean =>
  hasPatientFieldSyncOwnership(field, 'remoteCanonical');

export const isLocalNarrativePatientField = (field: string): boolean =>
  hasPatientFieldSyncOwnership(field, 'localNarrative');

export const isAdminRemotePatientField = (field: string): boolean =>
  hasPatientFieldSyncOwnership(field, 'adminRemote');

const isEmptyClinicalValue = (value: unknown): boolean =>
  value === '' ||
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0);

export const RECORD_STRUCTURAL_FIELDS = new Set([
  'date',
  'beds',
  'discharges',
  'transfers',
  'cma',
  'nurses',
  'nursesDayShift',
  'nursesNightShift',
  'tensDayShift',
  'tensNightShift',
  'activeExtraBeds',
  'rayenSyncHistory',
  'rayenBedCollisionResolutions',
  'handoffDayChecklist',
  'handoffNightChecklist',
  'medicalHandoffBySpecialty',
  'medicalSignature',
  'medicalSignatureByScope',
  'medicalHandoffSentAtByScope',
  'medicalSignatureLinkTokenByScope',
  'lastUpdated',
]);

export const selectScalarByPolicy = (
  path: string,
  remote: unknown,
  local: unknown,
  preferLocalDefault: boolean
): unknown => {
  return decideScalarByPolicy(path, remote, local, preferLocalDefault).value;
};

export const decideScalarByPolicy = (
  path: string,
  remote: unknown,
  local: unknown,
  preferLocalDefault: boolean
): ScalarPolicyDecision => {
  if (local === undefined) {
    return { value: remote, winner: 'remote', reason: 'local_undefined_fallback' };
  }
  if (remote === undefined) {
    return { value: local, winner: 'local', reason: 'remote_undefined_fallback' };
  }

  if (ROOT_LOCAL_PRIORITY_FIELDS.has(path)) {
    return { value: local, winner: 'local', reason: 'root_local_priority' };
  }
  if (ROOT_REMOTE_PRIORITY_FIELDS.has(path)) {
    return { value: remote, winner: 'remote', reason: 'root_remote_priority' };
  }

  const context = resolveConflictDomainContextForPath(path);
  if (context === 'handoff') {
    return { value: local, winner: 'local', reason: 'handoff_local_priority' };
  }
  if (context === 'staffing') {
    return { value: local, winner: 'local', reason: 'staffing_local_priority' };
  }
  if (context === 'metadata') {
    return { value: remote, winner: 'remote', reason: 'metadata_remote_priority' };
  }

  const parts = path.split('.');
  if (parts[0] === 'beds' && parts.length >= 3) {
    const patientField = parts[2];
    if (isClinicalCensusRemotePriorityField(patientField)) {
      if (isEmptyClinicalValue(local) && !isEmptyClinicalValue(remote)) {
        return {
          value: remote,
          winner: 'remote',
          reason: 'clinical_remote_non_empty_fallback',
        };
      }
      return {
        value: remote,
        winner: 'remote',
        reason: 'clinical_census_remote_priority',
      };
    }
    if (isLocalNarrativePatientField(patientField)) {
      if (isEmptyClinicalValue(local) && !isEmptyClinicalValue(remote)) {
        return {
          value: remote,
          winner: 'remote',
          reason: 'clinical_remote_non_empty_fallback',
        };
      }
      return { value: local, winner: 'local', reason: 'clinical_local_priority' };
    }
    if (isAdminRemotePatientField(patientField)) {
      return { value: remote, winner: 'remote', reason: 'admin_remote_priority' };
    }
  }

  if (preferLocalDefault) {
    return { value: local, winner: 'local', reason: 'default_local_priority' };
  }
  return { value: remote, winner: 'remote', reason: 'default_remote_priority' };
};
