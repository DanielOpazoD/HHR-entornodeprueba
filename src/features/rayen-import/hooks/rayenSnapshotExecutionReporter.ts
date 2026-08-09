import type { Dispatch } from 'react';
import type {
  RayenSyncExecutionAction,
  RayenSyncExecutionOutcome,
  RayenSyncStage,
} from './rayenSyncExecutionState';

interface RayenSnapshotExecutionIdentity {
  runId: string;
  requestId: string;
  selectedDate?: string;
}

export const createRayenSnapshotExecutionReporter = (
  dispatch: Dispatch<RayenSyncExecutionAction>,
  identity: RayenSnapshotExecutionIdentity
) => ({
  transition(stage: RayenSyncStage) {
    dispatch({ type: 'transition', ...identity, stage });
  },
  recordOutcome(outcome: Partial<RayenSyncExecutionOutcome>) {
    dispatch({ type: 'record_outcome', ...identity, ...outcome });
  },
});
