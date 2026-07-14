import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import {
  CONFLICT_RESOLUTION_POLICY_VERSION,
  RECORD_STRUCTURAL_FIELDS,
  decideScalarByPolicy,
} from '@/services/repositories/conflictResolutionPolicy';
import {
  getValueAtPath,
  normalizeChangedPaths,
  toIso,
  toMillis,
} from '@/services/repositories/conflictResolutionUtils';
import {
  ConflictResolutionTrace,
  ConflictResolutionTraceContext,
  createConflictResolutionTraceContext,
  traceFromScalarDecision,
} from '@/services/repositories/conflictResolutionTrace';
import {
  ID_BASED_ARRAY_FIELDS,
  UNIQUE_ARRAY_FIELDS,
  mergeBeds,
  mergeUniquePrimitiveArray,
  mergePatientData,
} from '@/services/repositories/conflictResolutionMergeUtils';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { mergeRecordObjectFields } from '@/services/repositories/conflictResolutionRecordObjectMergeUtils';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';
import {
  STAFFING_SLOT_ARRAY_FIELDS,
  buildMergedDayShiftStaffingMirror,
  resolveCanonicalDayShiftNurses,
  resolveStaffingSlotArray,
} from '@/services/repositories/conflictResolutionStaffingMergeUtils';
import { resolvePathValueWithMatrix } from '@/services/repositories/conflictResolutionPathMatrix';

interface ConflictResolutionOptions {
  changedPaths?: string[];
}

export interface ConflictResolutionResult {
  record: DailyRecord;
  trace: ConflictResolutionTrace;
}

export const resolveDailyRecordConflict = (
  remote: DailyRecord,
  local: DailyRecord,
  options: ConflictResolutionOptions = {}
): DailyRecord => {
  return resolveDailyRecordConflictWithTrace(remote, local, options).record;
};

export const resolveDailyRecordConflictWithTrace = (
  remote: DailyRecord,
  local: DailyRecord,
  options: ConflictResolutionOptions = {}
): ConflictResolutionResult => {
  const traceContext = createConflictResolutionTraceContext();
  const changedPaths = normalizeChangedPaths(options.changedPaths);
  if (changedPaths.length === 0 || changedPaths.includes('*')) {
    return {
      record: resolveWholeRecord(remote, local, traceContext),
      trace: {
        policyVersion: CONFLICT_RESOLUTION_POLICY_VERSION,
        entries: traceContext.entries,
      },
    };
  }
  return {
    record: resolveByChangedPaths(remote, local, changedPaths, traceContext),
    trace: {
      policyVersion: CONFLICT_RESOLUTION_POLICY_VERSION,
      entries: traceContext.entries,
    },
  };
};

const resolveWholeRecord = (
  remote: DailyRecord,
  local: DailyRecord,
  traceContext: ConflictResolutionTraceContext
): DailyRecord => {
  const localTs = toMillis(local.lastUpdated);
  const remoteTs = toMillis(remote.lastUpdated);
  const preferLocal = localTs >= remoteTs;
  const preferred = preferLocal ? local : remote;
  const secondary = preferLocal ? remote : local;
  const resolvedNursesDayShift = resolveCanonicalDayShiftNurses(
    remote,
    local,
    preferLocal,
    traceContext
  );

  const resolved: DailyRecord = {
    ...secondary,
    ...preferred,
    date: remote.date || local.date,
    beds: mergeBeds(remote.beds, local.beds, preferLocal, traceContext, 'beds'),
    discharges: mergeMovementArrayById(
      remote.discharges,
      local.discharges,
      preferLocal,
      traceContext,
      'discharges'
    ),
    transfers: mergeMovementArrayById(
      remote.transfers,
      local.transfers,
      preferLocal,
      traceContext,
      'transfers'
    ),
    cma: mergeMovementArrayById(remote.cma, local.cma, preferLocal, traceContext, 'cma'),
    // Keep legacy `nurses` only as a compatibility mirror of the canonical day shift array.
    nurses: [...resolvedNursesDayShift],
    nursesDayShift: resolvedNursesDayShift,
    nursesNightShift: resolveStaffingSlotArray(
      remote,
      local,
      'nursesNightShift',
      preferLocal,
      traceContext
    ),
    tensDayShift: resolveStaffingSlotArray(
      remote,
      local,
      'tensDayShift',
      preferLocal,
      traceContext
    ),
    tensNightShift: resolveStaffingSlotArray(
      remote,
      local,
      'tensNightShift',
      preferLocal,
      traceContext
    ),
    activeExtraBeds: mergeUniquePrimitiveArray(
      remote.activeExtraBeds || [],
      local.activeExtraBeds || [],
      preferLocal,
      traceContext,
      'activeExtraBeds'
    ),
    rayenSyncHistory: mergeRayenSyncHistory(remote.rayenSyncHistory, local.rayenSyncHistory),
    ...mergeRecordObjectFields(remote, local, preferLocal, traceContext),
    lastUpdated: toIso(Math.max(remoteTs, localTs)),
  };

  const remoteRecord = remote as unknown as Record<string, unknown>;
  const localRecord = local as unknown as Record<string, unknown>;
  const scalarKeys = new Set([...Object.keys(remoteRecord), ...Object.keys(localRecord)]);
  scalarKeys.forEach(key => {
    if (RECORD_STRUCTURAL_FIELDS.has(key)) return;
    const decision = decideScalarByPolicy(key, remoteRecord[key], localRecord[key], preferLocal);
    (resolved as unknown as Record<string, unknown>)[key] = decision.value;
    traceContext.add(traceFromScalarDecision(key, decision));
  });

  return normalizeMovementBedConsistency(resolved).record;
};

const resolveByChangedPaths = (
  remote: DailyRecord,
  local: DailyRecord,
  changedPaths: string[],
  traceContext: ConflictResolutionTraceContext
): DailyRecord => {
  const patches: DailyRecordPatch = {};

  for (const path of changedPaths) {
    if (path === '*') {
      return resolveWholeRecord(remote, local, traceContext);
    }

    const [root, second, third] = path.split('.');

    if (root === 'beds') {
      if (!second) {
        (patches as Record<string, unknown>).beds = mergeBeds(
          remote.beds,
          local.beds,
          true,
          traceContext,
          'beds',
          // The caller explicitly listed `beds` as a changed path, so every
          // bed under it is treated as locally edited. This preserves the
          // "intentional clear" semantics for bulk bed clears while still
          // letting `resolveWholeRecord` (without paths) drop the heuristic
          // for beds that were never touched. See issue #16.
          true
        );
        continue;
      }

      if (!third) {
        const remoteBed = remote.beds[second];
        const localBed = local.beds[second];
        (patches as Record<string, unknown>)[`beds.${second}`] = mergePatientData(
          remoteBed,
          localBed,
          true,
          traceContext,
          `beds.${second}`,
          // Single-bed path: caller asserts this bed was explicitly edited
          // locally, so an empty local payload counts as intentional clear.
          true
        );
        continue;
      }

      const patchValue = resolvePathValueWithMatrix(remote, local, path, traceContext);
      (patches as Record<string, unknown>)[path] = patchValue;
      continue;
    }

    if (ID_BASED_ARRAY_FIELDS.has(root)) {
      const remoteMap = remote as unknown as Record<string, unknown>;
      const localMap = local as unknown as Record<string, unknown>;
      (patches as Record<string, unknown>)[root] = mergeMovementArrayById(
        remoteMap[root] as unknown[],
        localMap[root] as unknown[],
        true,
        traceContext,
        root
      );
      continue;
    }

    if (root === 'nurses' || root === 'nursesDayShift') {
      Object.assign(
        patches as Record<string, unknown>,
        buildMergedDayShiftStaffingMirror(remote, local, traceContext)
      );
      continue;
    }

    if (STAFFING_SLOT_ARRAY_FIELDS.has(root)) {
      (patches as Record<string, unknown>)[root] = resolveStaffingSlotArray(
        remote,
        local,
        root,
        true,
        traceContext,
        true
      );
      continue;
    }

    if (UNIQUE_ARRAY_FIELDS.has(root)) {
      const remoteMap = remote as unknown as Record<string, unknown>;
      const localMap = local as unknown as Record<string, unknown>;
      (patches as Record<string, unknown>)[root] = mergeUniquePrimitiveArray(
        (remoteMap[root] as string[]) || [],
        (localMap[root] as string[]) || [],
        true,
        traceContext,
        root
      );
      continue;
    }

    if (root === 'rayenSyncHistory') {
      (patches as Record<string, unknown>)[root] = mergeRayenSyncHistory(
        remote.rayenSyncHistory,
        local.rayenSyncHistory
      );
      traceContext.add({
        path: root,
        strategy: 'merge_array_by_id',
        winner: 'merged',
        reason: 'union_preserve_local_override',
      });
      continue;
    }

    const decision = decideScalarByPolicy(
      path,
      getValueAtPath(remote, path),
      getValueAtPath(local, path),
      true
    );
    (patches as Record<string, unknown>)[path] = decision.value;
    traceContext.add(traceFromScalarDecision(path, decision));
  }

  const merged = applyPatches(remote, patches);
  merged.lastUpdated = toIso(Math.max(toMillis(remote.lastUpdated), toMillis(local.lastUpdated)));
  return normalizeMovementBedConsistency(merged).record;
};
