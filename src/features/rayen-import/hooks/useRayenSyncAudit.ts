import { useCallback, useRef, type MutableRefObject } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type {
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
  const activeRunRef = useRef<RayenSyncRun | null>(null);
  const runsRef = useRef(new Map<string, RayenSyncRun>());

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
    (delta: RayenSyncPerformanceDelta, runId = activeRunRef.current?.id): void => {
      if (!runId) return;
      const run = runsRef.current.get(runId);
      if (run) run.performance = mergeRayenSyncPerformance(run.performance, delta);
    },
    []
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
      activeRunRef.current = run;
      runsRef.current.set(run.id, run);
      return run;
    },
    [actor, createId, now]
  );

  const ensureRun = useCallback((): RayenSyncRun => activeRunRef.current ?? startRun(), [startRun]);

  const applyRunToRecord = useCallback(
    (record: DailyRecord, diff: CensusImportDiff) => {
      const run = ensureRun();
      const event = buildAppliedRayenSyncEvent(run, diff, now().toISOString());
      const stamped: DailyRecord = {
        ...record,
        rayenSync: rayenSyncMetaFromEvent(event),
        rayenSyncHistory: upsertRayenSyncEvent(record.rayenSyncHistory, event),
      };
      return { run, event, record: stamped };
    },
    [ensureRun, now]
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
      staffingProposal?: NursingStaffingProposal | null
    ): Promise<void> => {
      // The applied record carries the authoritative run id. A newer manual attempt
      // may already be active while this background fill is finishing.
      const runId = recordAtApply.rayenSync?.runId;
      if (!runId) return;
      const coverage = buildRayenSyncCoverage(summary.total, summary.errors, now().toISOString());
      if (summary.incremental) coverage.incremental = summary.incremental;
      const liveRecord = currentRecordRef.current;
      const fallback = liveRecord?.rayenSyncHistory?.some(event => event.id === runId)
        ? liveRecord
        : recordAtApply;
      await persistMetadataPatch(fallback, base => {
        const appliedEvent = base.rayenSyncHistory?.find(event => event.id === runId);
        if (!appliedEvent) return { patch: null, value: false };
        const completedEvent = completeRayenSyncEvent(
          appliedEvent,
          coverage,
          buildRayenStaffingObservation(staffingProposal),
          mergeRayenSyncPerformance(
            runsRef.current.get(runId)?.performance ?? appliedEvent.performance,
            summary.performance
          )
        );
        const patch: DailyRecordPatch = {
          rayenSyncHistory: upsertRayenSyncEvent(base.rayenSyncHistory, completedEvent),
        };
        if (base.rayenSync?.runId === runId)
          patch.rayenSync = rayenSyncMetaFromEvent(completedEvent);
        return { patch, value: true };
      });
      // A missing event means another successful write superseded or removed this audit entry.
      // It must still release the in-memory run; thrown persistence failures intentionally do not.
      if (activeRunRef.current?.id === runId) activeRunRef.current = null;
      runsRef.current.delete(runId);
    },
    [currentRecordRef, now, persistMetadataPatch]
  );

  const failRun = useCallback(
    async (reason: RayenSyncFailureReason): Promise<void> => {
      const run = activeRunRef.current;
      const record = currentRecordRef.current;
      if (!run) return;
      activeRunRef.current = null;
      runsRef.current.delete(run.id);
      if (!record) return;
      const event = buildFailedRayenSyncEvent(run, reason, now().toISOString());
      await patchDailyRecord({
        rayenSyncHistory: upsertRayenSyncEvent(record.rayenSyncHistory, event),
      });
    },
    [currentRecordRef, now, patchDailyRecord]
  );

  const cancelRun = useCallback(() => {
    if (activeRunRef.current) runsRef.current.delete(activeRunRef.current.id);
    activeRunRef.current = null;
  }, []);

  return {
    startRun,
    ensureRun,
    recordRunPerformance,
    applyRunToRecord,
    persistAppliedRun,
    completeRun,
    failRun,
    cancelRun,
  };
};
