import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { AuthoringSessionGuard } from '@/services/session/authoringSession';
import type { RayenApplyFailureReason, RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import { raceWithTimeout } from '../domain/raceWithTimeout';
import { defaultMonotonicNow } from '../domain/rayenSyncPerformance';
import type { ClinicalFillRequest, ClinicalStageResult } from '../contracts/clinicalStageResult';
import { classifyRayenApplyFailureReason } from '../observability/rayenSyncDiagnostics';
import { applyConfirmedRayenImport, isRayenStructuralPlanChangedError } from './confirmRayenImport';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import {
  matchesRayenStructuralReplan,
  startRayenStructuralReviewTiming,
  type RayenStructuralReplan,
} from './rayenStructuralConvergence';
import {
  executeRayenStructuralPersistence,
  type RayenStructuralPersistenceOutcome,
} from './rayenStructuralCommitOutcome';
import {
  isRayenSyncExecutionCurrent,
  rayenSyncExecutionKey,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionIdentity,
  type RayenSyncExecutionState,
  type RayenSyncStage,
} from './rayenSyncExecutionState';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';
import type {
  ApplyRayenCensusDiff,
  ConfirmedRayenCensusApplyResult,
} from './useRayenCensusDiffApplication';

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

type ConfirmedRayenImportInput = Parameters<
  typeof applyConfirmedRayenImport<ConfirmedRayenCensusApplyResult>
>[0];

/** What one structural write applies; the reviewed route adds the person's resolutions. */
export type RayenStructuralWritePlan = Pick<
  ConfirmedRayenImportInput,
  | 'base'
  | 'diff'
  | 'replanDiff'
  | 'clinicalDay'
  | 'cmaAdmissionResolutions'
  | 'finalizeHistoricalDischarges'
>;

interface PersistRayenStructureThenClinicalInput {
  identity: RayenSyncExecutionIdentity;
  /**
   * The session that began this run. If it changes (another person, or a new generation), the run
   * stops in silence: nothing more is written, no clinical stage starts, no history is closed.
   */
  session: AuthoringSessionGuard;
  /**
   * A person confirmed the plan in the review modal. The modal closes while saving, stays closed
   * after the commit, and reopens to explain a failure. Without review it never opens to explain a
   * failure, and after the commit it stays open only for conflicts that remain to review.
   */
  afterReview: boolean;
  applyPreviousDays: boolean;
  /** Returns the plan to write, or null when this execution may no longer write it. */
  preparePlan: () => RayenStructuralWritePlan | null;
  executionRef: RefObject<RayenSyncExecutionState>;
  dispatchExecution: Dispatch<RayenSyncExecutionAction>;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  selectedDateRef?: RefObject<string | undefined>;
  preparedSyncContextRef: RefObject<PreparedRayenSyncContext | null>;
  structuralReplanRef: RefObject<RayenStructuralReplan | null>;
  structuralPersistenceExecutionKeysRef: RefObject<Set<string>>;
  runSerializedPersistence: <T>(operation: () => Promise<T>) => Promise<T>;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  ensureRun: ConfirmedRayenImportInput['ensureRun'];
  applyDiff: ApplyRayenCensusDiff;
  loadAuthoritativeStructuralRecord: (date: string) => Promise<DailyRecord>;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  failRun: (reason: RayenApplyFailureReason, runId?: string, applyError?: unknown) => Promise<void>;
  runClinicalStage: (source: ClinicalFillRequest) => Promise<ClinicalStageResult>;
  monotonicNow?: () => number;
}

/**
 * The one route from a confirmed structural plan to its outcome, with or without review: write it,
 * then continue to the clinical stage, return a changed plan to review, or fail the run.
 */
export const persistRayenStructureThenClinical = async ({
  identity,
  session,
  afterReview,
  applyPreviousDays,
  preparePlan,
  executionRef,
  dispatchExecution,
  setState,
  selectedDateRef,
  preparedSyncContextRef,
  structuralReplanRef,
  structuralPersistenceExecutionKeysRef,
  runSerializedPersistence,
  dailyRecord,
  isAdmin,
  ensureRun,
  applyDiff,
  loadAuthoritativeStructuralRecord,
  recordRunPerformance,
  failRun,
  runClinicalStage,
  monotonicNow = defaultMonotonicNow,
}: PersistRayenStructureThenClinicalInput): Promise<void> => {
  const { runId } = identity;
  const isCurrent = () =>
    session.isCurrent() && isRayenSyncExecutionCurrent(executionRef.current, identity);
  const isDateVisible = () => !selectedDateRef || selectedDateRef.current === identity.selectedDate;
  const transition = (stage: RayenSyncStage) =>
    dispatchExecution({ type: 'transition', ...identity, stage });
  let plan: RayenStructuralWritePlan | null = null;
  let structureCommitted = false;

  const continueAfterCommit = async (
    outcome: CommittedRayenStructuralPersistenceOutcome
  ): Promise<void> => {
    structureCommitted = true;
    // What is committed stays committed (its `applied` event included); the new session neither
    // continues A's run nor closes it.
    if (!session.isCurrent()) return;
    if (isCurrent()) {
      dispatchExecution({
        type: 'record_outcome',
        ...identity,
        committed: true,
        structuralConflicts: outcome.commit.structuralConflicts,
        skippedItems: outcome.commit.skippedItems,
      });
      preparedSyncContextRef.current = null;
      structuralReplanRef.current = null;
      if (isDateVisible()) {
        setState(previous => ({
          ...previous,
          diff: outcome.commit.diff,
          // After a review the person returns to the census: conflicts and pending corrections are
          // told by the review notice and the history, not by reopening the modal mid-clinical stage.
          isPreviewOpen: !afterReview && outcome.commit.structuralConflicts > 0,
          result: outcome.result,
          hasSkippedItems: outcome.commit.hasSkippedItems,
          error:
            outcome.kind === 'requires_fresh_capture'
              ? getRayenImportErrorMessage(outcome.error)
              : null,
        }));
      }
      transition({ type: 'syncing_clinical' });
    }
    // The structural CAS already committed. Even if its UI execution was superseded (same session)
    // while the write was in flight, enqueue the handoff; the clinical queue revalidates run authority
    // before any patch and discards an obsolete run without touching the newer census.
    await runClinicalStage(outcome.commit.clinicalHandoff);
  };

  const finishFailedPersistence = (error: unknown) => {
    if (!isCurrent()) return;
    if (isRayenStructuralPlanChangedError(error)) {
      const preparedContext = preparedSyncContextRef.current;
      if (preparedContext?.runId === runId) {
        preparedSyncContextRef.current = { ...preparedContext, record: error.freshRecord };
      }
      transition(
        error.replannedDiff.conflicts.length > 0
          ? { type: 'needs_review', scope: 'structure' }
          : { type: 'awaiting_review' }
      );
      const replan = structuralReplanRef.current;
      if (matchesRayenStructuralReplan(replan, identity)) {
        structuralReplanRef.current = startRayenStructuralReviewTiming(replan, monotonicNow);
      }
      setState(previous => ({
        ...previous,
        diff: error.replannedDiff,
        isPreviewOpen: true,
        result: null,
        hasSkippedItems: false,
        error: error.message,
      }));
      return;
    }
    preparedSyncContextRef.current = null;
    structuralReplanRef.current = null;
    transition({ type: 'failed' });
    // The classified cause is what separates «the session lost permission» from «the server
    // refused» in the history; a committed structure keeps its error out of the apply evidence.
    void failRun(
      classifyRayenApplyFailureReason(error),
      runId,
      structureCommitted ? undefined : error
    ).catch(() => undefined);
    if (isDateVisible()) {
      setState(previous => ({
        ...previous,
        ...(afterReview ? { isPreviewOpen: true } : {}),
        error: getRayenImportErrorMessage(error),
      }));
    }
  };

  await runRayenStructuralPersistenceLifecycle({
    executionKey: rayenSyncExecutionKey(identity),
    activeExecutionKeys: structuralPersistenceExecutionKeysRef.current,
    isCurrent,
    startPersistence: () => {
      plan = preparePlan();
      if (!plan) return false;
      transition({ type: 'persisting_structure' });
      setState(previous => ({
        ...previous,
        isPreviewOpen: false,
        hasSkippedItems: false,
        error: null,
      }));
      return true;
    },
    persist: () =>
      runSerializedPersistence(() => {
        const writePlan = plan;
        if (!isCurrent() || !writePlan) return Promise.resolve(null);
        return applyConfirmedRayenImport({
          ...writePlan,
          applyPreviousDays,
          dailyRecord,
          isAdmin,
          ensureRun,
          // The day's write turn may wait for another edit; the send re-checks this run's session.
          applyDiff: (record, diff, clinicalDay) => applyDiff(record, diff, clinicalDay, session),
          getFreshRecord: () => loadAuthoritativeStructuralRecord(writePlan.base.date),
          createId: () => crypto.randomUUID(),
          onRetry: () =>
            recordRunPerformance(
              { counters: { retries: 1 }, coordination: { structuralReplans: 1 } },
              runId
            ),
        });
      }),
    persistenceOptions: {
      applyPreviousDays,
      now: monotonicNow,
      onDuration: durationMs => {
        if (!isCurrent()) return;
        recordRunPerformance({ stagesMs: { structuralPersistence: durationMs } }, runId);
      },
    },
    continueAfterCommit,
    finishFailedPersistence,
  });
};
