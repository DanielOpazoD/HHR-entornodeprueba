import {
  executeRayenStructuralPersistence,
  type RayenStructuralPersistenceOutcome,
} from './rayenStructuralCommitOutcome';

export type CommittedRayenStructuralPersistenceOutcome = Exclude<
  RayenStructuralPersistenceOutcome,
  { kind: 'failed' }
>;

export type RayenStructuralPersistenceExecutionResult =
  | { kind: 'not_started' }
  | { kind: 'failed' }
  | { kind: 'committed'; outcome: CommittedRayenStructuralPersistenceOutcome };

interface RunRayenStructuralPersistenceLifecycleInput {
  executionKey: string;
  activeExecutionKeys: Set<string>;
  isCurrent: () => boolean;
  startPersistence: () => boolean | void;
  persist: Parameters<typeof executeRayenStructuralPersistence>[0];
  persistenceOptions?: Parameters<typeof executeRayenStructuralPersistence>[1];
  continueAfterCommit: (outcome: CommittedRayenStructuralPersistenceOutcome) => Promise<void>;
  finishFailedPersistence: (error: unknown) => void;
}

/** Owns the shared automatic, no-change, and confirmed structural persistence lifecycle. */
export const runRayenStructuralPersistenceLifecycle = async ({
  executionKey,
  activeExecutionKeys,
  isCurrent,
  startPersistence,
  persist,
  persistenceOptions,
  continueAfterCommit,
  finishFailedPersistence,
}: RunRayenStructuralPersistenceLifecycleInput): Promise<RayenStructuralPersistenceExecutionResult> => {
  if (!isCurrent() || activeExecutionKeys.has(executionKey)) return { kind: 'not_started' };
  activeExecutionKeys.add(executionKey);
  try {
    if (startPersistence() === false) return { kind: 'not_started' };
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
