import { useCallback, useRef, type RefObject } from 'react';
import type { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import {
  applyConfirmedRayenImport,
  committedRayenImportResultFromError,
  hasSkippedPreviousDayCorrections,
  isRayenStructuralPlanChangedError,
  type ConfirmedRayenImportResult,
} from './confirmRayenImport';
import { getRayenImportErrorMessage, type RayenImportState } from './rayenImportState';
import {
  isRayenSyncExecutionCurrent,
  rayenSyncExecutionIdentity,
  rayenSyncExecutionKey,
  type RayenSyncExecutionAction,
} from './rayenSyncExecutionState';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';
import {
  matchesRayenStructuralReplan,
  type RayenStructuralReplan,
} from './rayenStructuralConvergence';
import type { useRayenCensusDiffApplication } from './useRayenCensusDiffApplication';
import type { ClinicalFillRequest, ClinicalStageResult } from '../contracts/clinicalStageResult';
import type { useRayenSyncAudit } from './useRayenSyncAudit';
import type { useRayenSyncExecutionController } from './useRayenSyncExecutionController';
import { applyRayenHistoricalCorrectionState } from './rayenCensusPersistenceGuard';
import type {
  BedOccupancyCollisionResolution,
  CmaAdmissionResolution,
} from '../contracts/censusImportDiff';
import { resolveBedOccupancyCollisions } from '../domain/bedOccupancyCollisionPolicy';

type ExecutionController = ReturnType<typeof useRayenSyncExecutionController>;
type SyncAudit = ReturnType<typeof useRayenSyncAudit>;

interface UseRayenImportConfirmationInput {
  currentRecord: DailyRecord | null | undefined;
  currentRecordRef: RefObject<DailyRecord | null | undefined>;
  state: RayenImportState;
  setState: ExecutionController['setImportStateCurrent'];
  executionRef: ExecutionController['executionRef'];
  dispatchExecution: (action: RayenSyncExecutionAction) => void;
  transitionExecution: ExecutionController['transitionExecution'];
  preparedSyncContextRef: RefObject<PreparedRayenSyncContext | null>;
  structuralReplanRef: RefObject<RayenStructuralReplan | null>;
  selectedDateRef: RefObject<string | undefined>;
  dailyRecord: ReturnType<typeof useRepositories>['dailyRecord'];
  isAdmin: boolean;
  ensureRun: SyncAudit['ensureRun'];
  failRun: SyncAudit['failRun'];
  recordRunPerformance: SyncAudit['recordRunPerformance'];
  applyDiff: ReturnType<typeof useRayenCensusDiffApplication>;
  runClinicalStage: (source: ClinicalFillRequest) => Promise<ClinicalStageResult>;
  loadAuthoritativeStructuralRecord: (date: string) => Promise<DailyRecord>;
  runSerializedPersistence: <T>(operation: () => Promise<T>) => Promise<T>;
}

export const useRayenImportConfirmation = ({
  currentRecord,
  currentRecordRef,
  state,
  setState,
  executionRef,
  dispatchExecution,
  transitionExecution,
  preparedSyncContextRef,
  structuralReplanRef,
  selectedDateRef,
  dailyRecord,
  isAdmin,
  ensureRun,
  failRun,
  recordRunPerformance,
  applyDiff,
  runClinicalStage,
  loadAuthoritativeStructuralRecord,
  runSerializedPersistence,
}: UseRayenImportConfirmationInput) => {
  const confirmationExecutionKeysRef = useRef(new Set<string>());

  return useCallback(
    async (
      applyPreviousDays: boolean = true,
      bedCollisionResolutions: BedOccupancyCollisionResolution[] = [],
      cmaAdmissionResolutions: CmaAdmissionResolution[] = []
    ) => {
      const base =
        preparedSyncContextRef.current?.record ?? currentRecordRef.current ?? currentRecord;
      if (!base || !state.diff) return;
      const diff = resolveBedOccupancyCollisions(state.diff, bedCollisionResolutions);
      const unresolvedBedCollision = (diff.bedOccupancyCollisions ?? []).some(
        collision =>
          !(diff.bedOccupancyCollisionResolutions ?? []).some(
            resolution => resolution.collisionId === collision.id
          )
      );
      if (unresolvedBedCollision) {
        setState(previous => ({
          ...previous,
          isBusy: false,
          isSyncing: false,
          error:
            'La distribución elegida usa una cama que ya está reservada. Revisa las camas destino antes de confirmar.',
        }));
        return;
      }
      const run = ensureRun();
      const executionIdentity = rayenSyncExecutionIdentity(executionRef.current, run.id);
      if (
        !executionIdentity ||
        !isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)
      ) {
        return;
      }
      const confirmationKey = rayenSyncExecutionKey(executionIdentity);
      if (confirmationExecutionKeysRef.current.has(confirmationKey)) return;
      const structuralReplan = structuralReplanRef.current;
      if (!matchesRayenStructuralReplan(structuralReplan, executionIdentity)) {
        setState(previous => ({
          ...previous,
          error:
            'La evidencia estructural ya no corresponde a esta revisión. Vuelve a capturar el censo antes de confirmar.',
        }));
        return;
      }
      confirmationExecutionKeysRef.current.add(confirmationKey);
      transitionExecution({ type: 'persisting_structure' }, run.id);
      setState(previous => ({
        ...previous,
        isBusy: true,
        isSyncing: true,
        hasSkippedItems: false,
        error: null,
      }));
      const continueAfterStructuralCommit = async (
        result: ConfirmedRayenImportResult<Awaited<ReturnType<typeof applyDiff>>>,
        requiresFreshCapture = false,
        correctionError?: string
      ): Promise<void> => {
        const appliedDiff = result.appliedDiff;
        const skippedPreviousDays = hasSkippedPreviousDayCorrections(
          appliedDiff,
          applyPreviousDays
        );
        const hasPendingHistoricalCorrections = result.historicalCorrectionsPending;
        const hasHistoricalFollowUp =
          skippedPreviousDays || hasPendingHistoricalCorrections || requiresFreshCapture;
        const structuralConflicts = Math.max(
          appliedDiff.conflicts.length,
          appliedDiff.summary.conflicts
        );
        const isCurrent = isRayenSyncExecutionCurrent(executionRef.current, executionIdentity);
        if (isCurrent) {
          dispatchExecution({
            type: 'record_outcome',
            ...executionIdentity,
            structuralConflicts,
            skippedItems: Number(hasHistoricalFollowUp) + result.skipped.length,
          });
          const isExecutionDateVisible = selectedDateRef.current === executionIdentity.selectedDate;
          setState(previous => ({
            ...previous,
            isBusy: false,
            ...(isExecutionDateVisible
              ? {
                  diff: appliedDiff,
                  isPreviewOpen: structuralConflicts > 0 || requiresFreshCapture,
                  result,
                  hasSkippedItems: hasHistoricalFollowUp || result.skipped.length > 0,
                  error: correctionError ?? null,
                }
              : {}),
          }));
          transitionExecution({ type: 'verifying_structure' }, run.id);
          preparedSyncContextRef.current = null;
          structuralReplanRef.current = null;
          transitionExecution({ type: 'syncing_clinical' }, run.id);
        }

        // The structural CAS already committed. Even if its UI execution was superseded while the
        // write was in flight, enqueue the handoff; the clinical queue revalidates run authority
        // before any patch and discards an obsolete run without touching the newer census.
        const clinicalHandoff = applyRayenHistoricalCorrectionState(result.confirmedHandoff, {
          pending: result.historicalCorrectionsPending,
          requiresFreshCapture,
        });
        await runClinicalStage(clinicalHandoff);
      };
      try {
        const result = await runSerializedPersistence(() => {
          if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) {
            return Promise.resolve(null);
          }
          return applyConfirmedRayenImport({
            applyPreviousDays,
            cmaAdmissionResolutions,
            base,
            diff,
            dailyRecord,
            isAdmin,
            ensureRun,
            applyDiff,
            getFreshRecord: () => loadAuthoritativeStructuralRecord(base.date),
            replanDiff: async record =>
              resolveBedOccupancyCollisions(
                await structuralReplan.replan(record),
                bedCollisionResolutions
              ),
            clinicalDay: structuralReplan.clinicalDay,
            createId: () => crypto.randomUUID(),
            onRetry: () =>
              recordRunPerformance(
                {
                  counters: { retries: 1 },
                  coordination: { structuralReplans: 1 },
                },
                run.id
              ),
          });
        });
        if (!result) return;
        await continueAfterStructuralCommit(result);
      } catch (error) {
        const committedResult =
          committedRayenImportResultFromError<Awaited<ReturnType<typeof applyDiff>>>(error);
        if (committedResult) {
          await continueAfterStructuralCommit(
            committedResult,
            true,
            getRayenImportErrorMessage(error)
          );
          return;
        }
        if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) return;
        if (isRayenStructuralPlanChangedError(error)) {
          // Returning from this branch still executes `finally`; delete eagerly as well so the
          // same reviewed execution can be confirmed again without relying on control-flow detail.
          confirmationExecutionKeysRef.current.delete(confirmationKey);
          const preparedContext = preparedSyncContextRef.current;
          if (preparedContext?.runId === executionIdentity.runId) {
            preparedSyncContextRef.current = {
              ...preparedContext,
              record: error.freshRecord,
            };
          }
          transitionExecution(
            error.replannedDiff.conflicts.length > 0
              ? { type: 'needs_review', scope: 'structure' }
              : { type: 'awaiting_review' },
            run.id
          );
          setState(previous => ({
            ...previous,
            diff: error.replannedDiff,
            isPreviewOpen: true,
            isBusy: false,
            isSyncing: false,
            result: null,
            error: error.message,
          }));
          return;
        }
        transitionExecution({ type: 'failed' }, run.id);
        void failRun('apply_failed', run.id);
        const isExecutionDateVisible = selectedDateRef.current === executionIdentity.selectedDate;
        setState(previous => ({
          ...previous,
          isBusy: false,
          isSyncing: false,
          ...(isExecutionDateVisible
            ? {
                isPreviewOpen: true,
                error: getRayenImportErrorMessage(error),
              }
            : {}),
        }));
      } finally {
        confirmationExecutionKeysRef.current.delete(confirmationKey);
      }
    },
    [
      currentRecord,
      currentRecordRef,
      state.diff,
      applyDiff,
      runClinicalStage,
      dailyRecord,
      isAdmin,
      ensureRun,
      executionRef,
      dispatchExecution,
      failRun,
      recordRunPerformance,
      loadAuthoritativeStructuralRecord,
      runSerializedPersistence,
      setState,
      transitionExecution,
      preparedSyncContextRef,
      structuralReplanRef,
      selectedDateRef,
    ]
  );
};
