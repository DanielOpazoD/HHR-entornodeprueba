import { useCallback, useRef, type MutableRefObject } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type {
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncPerformanceDelta,
  RayenSyncSource,
} from '@/types/domain/rayenSync';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { ClinicalFillSummary } from '../clinicalFillRunner';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { RayenExtensionHealthState } from './useRayenExtensionHealth';
import {
  buildAppliedRayenSyncEvent,
  buildFailedRayenSyncEvent,
  buildRayenSyncCoverage,
  buildRayenStaffingObservation,
  completeRayenSyncEvent,
  rayenSyncMetaFromEvent,
  upsertRayenSyncEvent,
  type RayenSyncRun,
} from '../domain/rayenSyncHistory';
import { elapsedMilliseconds, mergeRayenSyncPerformance } from '../domain/rayenSyncPerformance';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { createRayenSyncRunLifecycle } from '../domain/rayenSyncRunLifecycle';
import {
  classifyRayenSyncError,
  reportRayenSyncTerminal,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';

interface UseRayenSyncAuditInput {
  currentRecordRef: MutableRefObject<DailyRecord | null | undefined>;
  patchDailyRecord: (patch: DailyRecordPatch) => Promise<unknown>;
  loadDailyRecord?: (date: string) => Promise<DailyRecord>;
  actor: string;
  now?: () => Date;
  createId?: () => string;
  monotonicNow?: () => number;
}

const defaultNow = (): Date => new Date();
const defaultCreateId = (): string => crypto.randomUUID();
const MAX_METADATA_WRITE_RETRIES = 2;

const isConcurrencyFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'ConcurrencyError' ||
    /modificado por otro usuario|actualiz[oó] hace un momento/i.test(error.message));

const assertMetadataPatchAccepted = (payload: unknown): void => {
  const result = (
    payload as
      | { result?: Parameters<typeof isDailyRecordWriteRejectedResult>[0] }
      | null
      | undefined
  )?.result;
  if (!result || !isDailyRecordWriteRejectedResult(result)) return;
  const error =
    result.blockingError ?? new Error(result.userSafeMessage || 'No se confirmó el guardado.');
  if (result.conflictSummary?.kind === 'concurrency') error.name = 'ConcurrencyError';
  throw error;
};

const sourceFromHealth = (health?: RayenExtensionHealthState): RayenSyncSource | undefined =>
  health?.report
    ? {
        extensionVersion: health.report.version,
        protocolVersion: health.report.protocolVersion,
        fichaMedico: health.report.fichaMedico.status,
        gestionCamas: health.report.gestionCamas.status,
      }
    : undefined;

export const failureReasonFromHealth = (
  health: RayenExtensionHealthState
): RayenSyncFailureReason => {
  if (health.connection === 'incompatible') return 'extension_incompatible';
  if (health.connection === 'blocked') {
    return health.report?.fichaMedico.status === 'ready'
      ? 'gestion_camas_unavailable'
      : 'ficha_medico_unavailable';
  }
  return 'extension_unavailable';
};

export const useRayenSyncAudit = ({
  currentRecordRef,
  patchDailyRecord,
  loadDailyRecord,
  actor,
  now = defaultNow,
  createId = defaultCreateId,
  monotonicNow = Date.now,
}: UseRayenSyncAuditInput) => {
  const lifecycleRef = useRef(createRayenSyncRunLifecycle());
  const lifecycle = lifecycleRef.current;

  const persistMetadataPatch = useCallback(
    async <T>(
      fallbackRecord: DailyRecord,
      build: (freshRecord: DailyRecord) => { patch: DailyRecordPatch | null; value: T }
    ): Promise<T> => {
      let base = fallbackRecord;
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_METADATA_WRITE_RETRIES; attempt += 1) {
        const prepared = build(base);
        if (!prepared.patch) return prepared.value;
        try {
          assertMetadataPatchAccepted(await patchDailyRecord(prepared.patch));
          return prepared.value;
        } catch (error) {
          lastError = error;
          if (
            !isConcurrencyFailure(error) ||
            !loadDailyRecord ||
            attempt === MAX_METADATA_WRITE_RETRIES
          ) {
            throw error;
          }
          base = await loadDailyRecord(base.date);
        }
      }
      throw lastError;
    },
    [loadDailyRecord, patchDailyRecord]
  );

  const recordRunPerformance = useCallback(
    (delta: RayenSyncPerformanceDelta, runId = lifecycle.getActiveRun()?.id): void => {
      if (!runId) return;
      const run = lifecycle.getRun(runId);
      if (run) run.performance = mergeRayenSyncPerformance(run.performance, delta);
    },
    [lifecycle]
  );

  const startRun = useCallback(
    (health?: RayenExtensionHealthState, performance?: RayenSyncPerformanceDelta): RayenSyncRun => {
      const run: RayenSyncRun = {
        id: createId(),
        startedAt: now().toISOString(),
        by: actor,
        source: sourceFromHealth(health),
        performance: mergeRayenSyncPerformance(undefined, performance),
      };
      const { superseded } = lifecycle.start(run);
      if (superseded) {
        reportRayenSyncTerminal(superseded, 'cancelled', {
          cancellationReason: 'superseded',
        });
      }
      return run;
    },
    [actor, createId, lifecycle, now]
  );

  const ensureRun = useCallback(
    (): RayenSyncRun => lifecycle.getActiveRun() ?? startRun(),
    [lifecycle, startRun]
  );

  const getRun = useCallback(
    (runId: string): RayenSyncRun | undefined => lifecycle.getRun(runId),
    [lifecycle]
  );

  const applyRunToRecord = useCallback(
    (record: DailyRecord, diff: CensusImportDiff) => {
      const run = ensureRun();
      const event = buildAppliedRayenSyncEvent(run, diff, now().toISOString());
      lifecycle.markApplied(run.id);
      const stamped: DailyRecord = {
        ...record,
        rayenSync: rayenSyncMetaFromEvent(event),
        rayenSyncHistory: upsertRayenSyncEvent(record.rayenSyncHistory, event),
      };
      return { run, event, record: stamped };
    },
    [ensureRun, lifecycle, now]
  );

  const persistAppliedRun = useCallback(
    async (record: DailyRecord, diff: CensusImportDiff): Promise<DailyRecord> => {
      const startedAt = monotonicNow();
      const stamped = await persistMetadataPatch(record, freshRecord => {
        const next = applyRunToRecord(freshRecord, diff).record;
        return {
          patch: { rayenSync: next.rayenSync, rayenSyncHistory: next.rayenSyncHistory },
          value: next,
        };
      });
      recordRunPerformance(
        {
          stagesMs: { persistence: elapsedMilliseconds(startedAt, monotonicNow()) },
          counters: { patches: 1 },
        },
        stamped.rayenSync?.runId
      );
      return stamped;
    },
    [applyRunToRecord, monotonicNow, persistMetadataPatch, recordRunPerformance]
  );

  const completeRun = useCallback(
    async (
      recordAtApply: DailyRecord,
      summary: ClinicalFillSummary,
      staffingProposal?: NursingStaffingProposal | null,
      requestedRunId?: string
    ): Promise<void> => {
      // The applied record carries the authoritative run id. A newer manual attempt
      // may already be active while this background fill is finishing.
      const runId = requestedRunId ?? recordAtApply.rayenSync?.runId;
      if (!runId) return;
      const claim = lifecycle.claimTerminal(runId);
      if (!claim) return;
      const coverage = buildRayenSyncCoverage(summary.total, summary.errors, now().toISOString());
      if (summary.incremental) coverage.incremental = summary.incremental;
      const liveRecord = currentRecordRef.current;
      const fallback = liveRecord?.rayenSyncHistory?.some(event => event.id === runId)
        ? liveRecord
        : recordAtApply;
      const buildCompletedEvent = (appliedEvent: RayenSyncEvent): RayenSyncEvent =>
        completeRayenSyncEvent(
          appliedEvent,
          coverage,
          buildRayenStaffingObservation(staffingProposal),
          mergeRayenSyncPerformance(
            claim.run?.performance ?? appliedEvent.performance,
            summary.performance
          )
        );
      try {
        const completedEvent = await persistMetadataPatch(fallback, base => {
          const appliedEvent = base.rayenSyncHistory?.find(event => event.id === runId);
          if (!appliedEvent) return { patch: null, value: null };
          const event = buildCompletedEvent(appliedEvent);
          const patch: DailyRecordPatch = {
            rayenSyncHistory: upsertRayenSyncEvent(base.rayenSyncHistory, event),
          };
          if (base.rayenSync?.runId === runId) patch.rayenSync = rayenSyncMetaFromEvent(event);
          return { patch, value: event };
        });
        lifecycle.commitTerminal(claim);
        if (completedEvent) {
          reportRayenSyncTerminal(
            claim.run ?? { id: completedEvent.id, startedAt: completedEvent.startedAt },
            completedEvent.status === 'partial' ? 'partial' : 'complete',
            {},
            completedEvent.completedAt
          );
        } else {
          reportRayenSyncWarning('sync_audit_event_missing', { runId });
          reportRayenSyncTerminal(
            claim.run ?? {
              id: runId,
              startedAt: recordAtApply.rayenSync?.at ?? now().toISOString(),
            },
            'failed'
          );
        }
      } catch (error) {
        reportRayenSyncWarning('sync_audit_persist_failed', {
          runId,
          errorKind: classifyRayenSyncError(error),
        });
        try {
          const failedEvent = await persistMetadataPatch(fallback, base => {
            const appliedEvent = base.rayenSyncHistory?.find(event => event.id === runId);
            if (!appliedEvent) return { patch: null, value: null };
            const event: RayenSyncEvent = {
              ...buildCompletedEvent(appliedEvent),
              status: 'failed',
              failureReason: 'apply_failed',
            };
            const patch: DailyRecordPatch = {
              rayenSyncHistory: upsertRayenSyncEvent(base.rayenSyncHistory, event),
            };
            if (base.rayenSync?.runId === runId) patch.rayenSync = rayenSyncMetaFromEvent(event);
            return {
              patch,
              value: event,
            };
          });
          if (failedEvent) {
            lifecycle.commitTerminal(claim);
            reportRayenSyncTerminal(
              claim.run ?? { id: failedEvent.id, startedAt: failedEvent.startedAt },
              'failed',
              { failureReason: 'apply_failed' },
              failedEvent.completedAt
            );
          } else {
            lifecycle.releaseTerminal(claim);
            reportRayenSyncWarning('sync_audit_event_missing', { runId });
          }
        } catch (recoveryError) {
          lifecycle.releaseTerminal(claim);
          reportRayenSyncWarning('sync_audit_terminal_recovery_failed', {
            runId,
            errorKind: classifyRayenSyncError(recoveryError),
          });
        }
        throw error;
      }
    },
    [currentRecordRef, lifecycle, now, persistMetadataPatch]
  );

  const failRun = useCallback(
    async (reason: RayenSyncFailureReason, runId = lifecycle.getActiveRun()?.id): Promise<void> => {
      const run = runId ? lifecycle.getRun(runId) : undefined;
      const record = currentRecordRef.current;
      if (!run) return;
      const claim = lifecycle.claimTerminal(run.id);
      if (!claim) return;
      const event = buildFailedRayenSyncEvent(run, reason, now().toISOString());
      if (record) {
        try {
          await persistMetadataPatch(record, base => ({
            patch: {
              rayenSyncHistory: upsertRayenSyncEvent(base.rayenSyncHistory, event),
            },
            value: undefined,
          }));
        } catch (error) {
          reportRayenSyncWarning('sync_audit_persist_failed', {
            runId: run.id,
            errorKind: classifyRayenSyncError(error),
          });
        }
      }
      lifecycle.commitTerminal(claim);
      reportRayenSyncTerminal(run, 'failed', { failureReason: reason }, event.completedAt);
    },
    [currentRecordRef, lifecycle, now, persistMetadataPatch]
  );

  const cancelRun = useCallback(() => {
    const cancellation = lifecycle.cancelActive();
    if (cancellation?.disposition === 'cancelled') {
      reportRayenSyncTerminal(cancellation.run, 'cancelled', {
        cancellationReason: 'operator',
      });
    }
  }, [lifecycle]);

  return {
    startRun,
    ensureRun,
    getRun,
    recordRunPerformance,
    applyRunToRecord,
    persistAppliedRun,
    completeRun,
    failRun,
    cancelRun,
  };
};
