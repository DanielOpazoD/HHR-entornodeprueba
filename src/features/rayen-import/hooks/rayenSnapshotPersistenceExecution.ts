import { raceWithTimeout } from '../domain/raceWithTimeout';
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
  /** Wall-clock ceiling for the structural write; the stage had none and could spin forever. */
  persistTimeoutMs?: number;
}

export const RAYEN_STRUCTURAL_PERSIST_TIMEOUT_MS = 90_000;

/** Message says "timeout" on purpose: the diagnostics classifier maps it to `source_timeout`. */
export const STRUCTURAL_PERSIST_TIMEOUT_MESSAGE =
  'Structural persist timeout: el guardado del censo superó los 90 s. Reintenta; si ya se guardó, la próxima sincronización lo confirmará.';

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
  persistTimeoutMs = RAYEN_STRUCTURAL_PERSIST_TIMEOUT_MS,
}: RunRayenStructuralPersistenceLifecycleInput): Promise<RayenStructuralPersistenceExecutionResult> => {
  if (!isCurrent() || activeExecutionKeys.has(executionKey)) return { kind: 'not_started' };
  activeExecutionKeys.add(executionKey);
  try {
    if (startPersistence() === false) return { kind: 'not_started' };
    let outcome: Awaited<ReturnType<typeof executeRayenStructuralPersistence>>;
    try {
      outcome = await raceWithTimeout(
        executeRayenStructuralPersistence(persist, persistenceOptions),
        persistTimeoutMs,
        () => Object.assign(new Error(STRUCTURAL_PERSIST_TIMEOUT_MESSAGE), { name: 'TimeoutError' })
      );
    } catch (error) {
      finishFailedPersistence(error);
      return { kind: 'failed' };
    }
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
