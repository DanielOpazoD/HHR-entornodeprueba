import {
  executeRayenStructuralPersistence,
  type RayenStructuralPersistenceOutcome,
} from './rayenStructuralCommitOutcome';

export type CommittedRayenSnapshotPersistenceOutcome = Exclude<
  RayenStructuralPersistenceOutcome,
  { kind: 'failed' }
>;

export type RayenSnapshotPersistenceExecutionResult =
  | { kind: 'not_started' }
  | { kind: 'failed' }
  | { kind: 'committed'; outcome: CommittedRayenSnapshotPersistenceOutcome };

interface RunRayenSnapshotPersistenceInput {
  executionKey: string;
  activeExecutionKeys: Set<string>;
  isCurrent: () => boolean;
  startPersistence: () => void;
  persist: Parameters<typeof executeRayenStructuralPersistence>[0];
  persistenceOptions?: Parameters<typeof executeRayenStructuralPersistence>[1];
  continueAfterCommit: (outcome: CommittedRayenSnapshotPersistenceOutcome) => Promise<void>;
  finishFailedPersistence: (error: unknown) => void;
}

/** Owns the single automatic/no-change snapshot persistence lifecycle. */
export const runRayenSnapshotPersistence = async ({
  executionKey,
  activeExecutionKeys,
  isCurrent,
  startPersistence,
  persist,
  persistenceOptions,
  continueAfterCommit,
  finishFailedPersistence,
}: RunRayenSnapshotPersistenceInput): Promise<RayenSnapshotPersistenceExecutionResult> => {
  if (!isCurrent() || activeExecutionKeys.has(executionKey)) return { kind: 'not_started' };
  activeExecutionKeys.add(executionKey);
  try {
    startPersistence();
    const outcome = await executeRayenStructuralPersistence(persist, persistenceOptions);
    if (!outcome) return { kind: 'not_started' };
    if (outcome.kind === 'failed') {
      finishFailedPersistence(outcome.error);
      return { kind: 'failed' };
    }
    if (outcome.kind === 'requires_fresh_capture') {
      await continueAfterCommit(outcome);
      return { kind: 'committed', outcome };
    }
    try {
      await continueAfterCommit(outcome);
      return { kind: 'committed', outcome };
    } catch (error) {
      finishFailedPersistence(error);
      return { kind: 'failed' };
    }
  } finally {
    activeExecutionKeys.delete(executionKey);
  }
};
