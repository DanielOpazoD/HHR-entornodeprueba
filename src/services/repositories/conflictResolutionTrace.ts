import { ScalarPolicyDecision } from '@/services/repositories/conflictResolutionPolicy';

export type ConflictResolutionStrategy =
  | 'scalar_policy'
  | 'merge_array_by_id'
  | 'merge_unique_primitive_array'
  | 'merge_fixed_staffing_slots'
  | 'merge_object'
  | 'merge_patient'
  | 'merge_beds'
  | 'copy_preferred_active_devices'
  | 'copy_local_value'
  | 'copy_remote_value';

export interface ConflictResolutionTraceEntry {
  path: string;
  strategy: ConflictResolutionStrategy;
  winner: 'local' | 'remote' | 'merged';
  reason: string;
}

export interface ConflictResolutionTrace {
  policyVersion: string;
  entries: ConflictResolutionTraceEntry[];
}

export interface ConflictResolutionTraceContext {
  entries: ConflictResolutionTraceEntry[];
  add: (entry: ConflictResolutionTraceEntry) => void;
}

export const createConflictResolutionTraceContext = (): ConflictResolutionTraceContext => {
  const entries: ConflictResolutionTraceEntry[] = [];
  return {
    entries,
    add: entry => {
      entries.push(entry);
    },
  };
};

export const traceFromScalarDecision = (
  path: string,
  decision: ScalarPolicyDecision
): ConflictResolutionTraceEntry => ({
  path,
  strategy: 'scalar_policy',
  winner: decision.winner,
  reason: decision.reason,
});
