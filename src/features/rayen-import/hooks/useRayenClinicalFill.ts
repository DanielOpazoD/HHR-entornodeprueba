import { useCallback } from 'react';
import { guardAuthoringSession } from '@/services/session/authoringSession';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import type { ClinicalFillSummary } from '../clinicalFillRunner';
import type {
  HistoricalCudyrBatchExecutionResult,
  HistoricalCudyrBatchItem,
} from '../contracts/clinicalFillContracts';
import type { ClinicalFillRequest, ClinicalStageResult } from '../contracts/clinicalStageResult';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { createClinicalFillReaders } from '../bridge/clinicalFillReaders';
import { collectClinicalFillCandidates } from '../domain/clinicalFillCandidates';
import {
  buildClinicalRetryToken,
  mergeClinicalRetrySummary,
} from '../domain/clinicalStageResolution';
import { enqueueLatestRayenClinicalFill } from '../domain/rayenClinicalFillQueue';
import {
  buildGlobalClinicalFillError,
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';
import {
  finalizeClinicalFillRun,
  resolveClinicalFillRequest,
  revalidateClinicalFillDay,
  withRevalidatedClinicalRecord,
  type AuthoringSession,
  type ClinicalFillRunnerModule,
  type CompleteClinicalFillRun,
  type ResolvedClinicalFillRequest,
  type RevalidateClinicalFillOutcome,
} from './clinicalFillStageSteps';
import {
  isConfirmedRayenCensusHandoff,
  type ConfirmedRayenCensusHandoff,
} from './rayenCensusPersistenceGuard';
import { toIsoReportDate } from './reportDateHelpers';
import {
  beginRayenFill,
  endRayenFill,
  getRayenFillAttemptId,
  registerRayenFillAbort,
  reportRayenFillProgress,
} from './useRayenFillStatus';

interface UseRayenClinicalFillInput {
  nurseCatalog: string[];
  tensCatalog: string[];
  loadDailyRecord: (date: string) => Promise<DailyRecord>;
  loadCudyrIdentityContext?: (date: string) => Promise<DailyRecord | null>;
  applyHistoricalCudyrEnforcedBatch?: (
    sourceRecord: DailyRecord,
    censusDay: string,
    items: HistoricalCudyrBatchItem[],
    runId: string,
    checkSession?: () => void
  ) => Promise<HistoricalCudyrBatchExecutionResult>;
  completeRun: CompleteClinicalFillRun;
  onStaffingProposal: (proposal: NursingStaffingProposal, attemptId: number) => void;
  createId: () => string;
  recordRunPerformance?: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
}

export const resolveClinicalFillDay = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord
): string => (isConfirmedRayenCensusHandoff(source) ? source.clinicalDay : toIsoReportDate(record));

const recordAuthorityRevision = (record: DailyRecord): unknown =>
  (record as DailyRecord & { meta?: { revision?: unknown } }).meta?.revision;

const readClinicalDerivedLayout = (
  record: DailyRecord
): { version?: unknown; generation?: unknown } | null => {
  const layout = record.clinicalDerivedLayout;
  return layout && typeof layout === 'object'
    ? (layout as { version?: unknown; generation?: unknown })
    : null;
};

const hasUnchangedDerivedDaySnapshot = (previous: DailyRecord, latest: DailyRecord): boolean => {
  const previousRevision = recordAuthorityRevision(previous);
  const previousLayout = readClinicalDerivedLayout(previous);
  const latestLayout = readClinicalDerivedLayout(latest);
  return (
    previousLayout !== null &&
    latestLayout !== null &&
    previous.date === latest.date &&
    previous.lastUpdated === latest.lastUpdated &&
    typeof previousRevision === 'number' &&
    previousRevision === recordAuthorityRevision(latest) &&
    typeof previousLayout.version === 'number' &&
    previousLayout.version === latestLayout.version &&
    typeof previousLayout.generation === 'string' &&
    previousLayout.generation.length > 0 &&
    previousLayout.generation === latestLayout.generation
  );
};

/** Steps 2–3: read clinical sources, persist authoritative batches, and retry field conflicts. */
const executeClinicalFillPass = async ({
  input,
  resolved,
  revalidated,
  runner,
  session,
  attemptId,
}: {
  input: UseRayenClinicalFillInput;
  resolved: ResolvedClinicalFillRequest;
  revalidated: Extract<RevalidateClinicalFillOutcome, { ok: true }>;
  runner: ClinicalFillRunnerModule;
  session: AuthoringSession;
  attemptId: number;
}): Promise<{
  summary: ClinicalFillSummary;
  committedAuditRecord: DailyRecord | null;
  historicalCudyrEpisodeIds: string[];
}> => {
  const { check } = session;
  const { retryRequest, source, confirmedHandoff, record, allowedClinicalEpisodeIds } = resolved;
  const { freshRecord, fillRecord, runPolicy, auditRunId, eligibleCount, loadDay, isSuperseded } =
    revalidated;

  const clinicalCandidates = collectClinicalFillCandidates(fillRecord, allowedClinicalEpisodeIds);
  const historicalCudyrEpisodeIds = runner.collectDailyCudyrRecoveryEpisodes({
    acceptedRecord: record,
    currentRecord: fillRecord,
    conflicts: confirmedHandoff?.isolatedConflicts ?? [],
    pendingEpisodeIds: retryRequest?.pendingHistoricalCudyrEpisodeIds,
  });

  // Capture the latest committed un-overlaid day from the post-batch readback so
  // `completeRun` starts on the committed revision instead of colliding on the stale base.
  let committedAuditRecord: DailyRecord | null = null;

  // One fill over a day read and its batch write. The field-conflict retry reruns it.
  const fillOnce = async (
    day: DailyRecord,
    view: DailyRecord,
    episodeIds: readonly string[] | undefined,
    candidates: typeof clinicalCandidates,
    conflictRetry = false
  ): Promise<ClinicalFillSummary> => {
    const watchdog = runner.createClinicalFillWatchdog({
      onTimeout: () => reportRayenSyncWarning('clinical_fill_stage_timeout', { runId: auditRunId }),
    });
    registerRayenFillAbort(watchdog.abort, attemptId);
    try {
      const { applyClinicalFillBatch } = await import('./applyClinicalEnrichmentBatch');
      check();
      const { registerEloisaStaff } = await import('@/services/staff/eloisaStaffRegistry');
      check();
      // The batch re-reads the day at its write turn: overlay that read too (D10).
      // Per D2, episode documents only mutate in the same transaction that increments
      // `meta.revision` (or layout generation), so an unchanged server day reuses `view`.
      const refreshFillRecord = async (): Promise<DailyRecord> => {
        check();
        const latest = await loadDay();
        check();
        if (day.clinicalDerivedLayout != null && hasUnchangedDerivedDaySnapshot(day, latest)) {
          return view;
        }
        const latestView = await readClinicalFillDerivedView(latest, loadDay);
        check();
        return latestView.record;
      };
      return await runner.runClinicalFill(
        view,
        resolveClinicalFillDay(source, day),
        {
          diagnosticRunId: auditRunId,
          signal: watchdog.signal,
          allowedClinicalEpisodeIds: episodeIds,
          historicalCudyrEpisodeIds: conflictRetry ? [] : historicalCudyrEpisodeIds,
          recoverMissingCudyr: runner.createDailyCudyrRecoveryReader({
            signal: watchdog.signal,
            loadDay: input.loadCudyrIdentityContext ?? input.loadDailyRecord,
          }),
          pendingReads: conflictRetry ? undefined : retryRequest?.pendingReads,
          ...createClinicalFillReaders(watchdog.signal, candidates),
          extractDeviceItems: runner.extractDeviceTextItems,
          persistBatch: operations =>
            applyClinicalFillBatch({
              checkSession: check,
              record: view,
              runId: runPolicy.runId,
              operations,
              refreshRecord: refreshFillRecord,
              // After a committed batch the day's server read refreshes the Firestore
              // SDK cache, not HHR's local table; nothing is rebuilt from it, so no
              // episode documents are read. Keep the returned un-overlaid day for audit.
              refreshCommittedRecord: async () => {
                const committed = await loadDay();
                if (
                  committed.date === freshRecord.date &&
                  (!auditRunId ||
                    committed.rayenSyncHistory?.some(event => event.id === auditRunId))
                ) {
                  committedAuditRecord = committed;
                }
                return committed;
              },
            }),
          applyHistoricalCudyrBatch: (censusDay, items) => {
            check();
            if (!input.applyHistoricalCudyrEnforcedBatch) {
              throw new Error('El lote histórico autoritativo no está disponible.');
            }
            return input.applyHistoricalCudyrEnforcedBatch(
              day,
              censusDay,
              items,
              runPolicy.runId,
              check
            );
          },
          // The attempt already archived the census capture; the retry only rewrites.
          archiveCudyrCapture: conflictRetry
            ? undefined
            : request =>
                import('@/features/rayen-import/services/cudyrArchiveQueue').then(
                  ({ persistCudyrArchivePart }) => {
                    check();
                    return persistCudyrArchivePart(request, watchdog.signal, session);
                  }
                ),
          now: () => new Date(),
          createId: input.createId,
          nurseCatalog: input.nurseCatalog,
          tensCatalog: input.tensCatalog,
          registerStaff: observations => {
            check();
            return registerEloisaStaff(observations);
          },
        },
        conflictRetry
          ? undefined
          : ({ done, total }) => reportRayenFillProgress(done, total, attemptId)
      );
    } finally {
      watchdog.settle();
      registerRayenFillAbort(null, attemptId);
    }
  };

  let summary: ClinicalFillSummary;
  try {
    summary = await fillOnce(
      freshRecord,
      fillRecord,
      allowedClinicalEpisodeIds,
      clinicalCandidates
    );
  } catch (error) {
    check();
    reportRayenSyncWarning('clinical_fill_failed', {
      runId: auditRunId,
      errorKind: classifyRayenSyncError(error),
      patientCount: eligibleCount,
    });
    summary = {
      total: eligibleCount,
      patched: 0,
      errors: [buildGlobalClinicalFillError('unexpected_fill_failure')],
    };
  }

  summary = await runner.retryFieldConflicts(
    summary,
    auditRunId,
    loadDay,
    isSuperseded,
    check,
    fillOnce,
    input.recordRunPerformance
  );

  check();
  summary = mergeClinicalRetrySummary(
    retryRequest?.previousSummary,
    summary,
    new Set(clinicalCandidates.map(candidate => candidate.bedId)),
    new Set([
      ...clinicalCandidates.map(({ patient }) => patient.clinicalEpisodeId!),
      ...historicalCudyrEpisodeIds,
    ])
  );

  return { summary, committedAuditRecord, historicalCudyrEpisodeIds };
};

/** Runs the best-effort per-patient clinical enrichment and persists aggregate run evidence. */
export const useRayenClinicalFill = ({
  nurseCatalog,
  tensCatalog,
  loadDailyRecord,
  loadCudyrIdentityContext,
  applyHistoricalCudyrEnforcedBatch,
  completeRun,
  onStaffingProposal,
  createId,
  recordRunPerformance,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (request: ClinicalFillRequest): Promise<ClinicalStageResult> => {
      const session = guardAuthoringSession();
      const sessionChanged = () => !session.isCurrent();
      const { check } = session;
      let activeAttemptId: number | undefined;
      const resolved = resolveClinicalFillRequest(request);
      const { source, record, allowedClinicalEpisodeIds, requestedRunId, queueKey } = resolved;

      const queued = await enqueueLatestRayenClinicalFill(
        record.date,
        queueKey,
        async ({ startedAfterQueue }) => {
          try {
            check();
            // The watchdog and the device text reader only exist while a fill runs, so they ship
            // with the on-demand runner chunk (outside the PWA precache), not the import button.
            const runner = await import('../clinicalFillRunner');
            check();

            const revalidated = await revalidateClinicalFillDay({
              resolved,
              startedAfterQueue,
              runner,
              loadDailyRecord,
              completeRun,
              check,
            });
            if (!revalidated.ok) return revalidated.result;

            if (!beginRayenFill(revalidated.eligibleCount)) {
              await completeRun(
                revalidated.freshRecord,
                {
                  total: revalidated.eligibleCount,
                  patched: 0,
                  errors: [buildGlobalClinicalFillError('clinical_fill_busy')],
                },
                null,
                requestedRunId,
                { checkSession: check }
              ).catch(() => undefined);
              return {
                status: 'failed',
                retry: buildClinicalRetryToken(
                  withRevalidatedClinicalRecord(source, revalidated.freshRecord),
                  revalidated.freshRecord,
                  allowedClinicalEpisodeIds
                ),
              };
            }

            const attemptId = getRayenFillAttemptId();
            activeAttemptId = attemptId;

            const { summary, committedAuditRecord, historicalCudyrEpisodeIds } =
              await executeClinicalFillPass({
                input: {
                  nurseCatalog,
                  tensCatalog,
                  loadDailyRecord,
                  loadCudyrIdentityContext,
                  applyHistoricalCudyrEnforcedBatch,
                  completeRun,
                  onStaffingProposal,
                  createId,
                  recordRunPerformance,
                },
                resolved,
                revalidated,
                runner,
                session,
                attemptId,
              });

            return await finalizeClinicalFillRun({
              resolved,
              freshRecord: revalidated.freshRecord,
              auditRunId: revalidated.auditRunId,
              summary,
              committedAuditRecord,
              historicalCudyrEpisodeIds,
              attemptId,
              completeRun,
              onStaffingProposal,
              check,
            });
          } catch (error) {
            if (!sessionChanged()) throw error;
            if (activeAttemptId !== undefined) endRayenFill(0, true, activeAttemptId);
            return { status: 'failed' };
          }
        }
      );

      if (sessionChanged()) return { status: 'failed' };
      if (queued.result) return queued.result;
      return queued.outcome === 'superseded'
        ? { status: 'failed' }
        : {
            status: 'failed',
            retry: buildClinicalRetryToken(source, record, allowedClinicalEpisodeIds),
          };
    },
    [
      applyHistoricalCudyrEnforcedBatch,
      completeRun,
      createId,
      loadDailyRecord,
      loadCudyrIdentityContext,
      nurseCatalog,
      tensCatalog,
      onStaffingProposal,
      recordRunPerformance,
    ]
  );
