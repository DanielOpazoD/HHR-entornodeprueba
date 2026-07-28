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

interface UseRayenSyncAuditInput {
  currentRecordRef: MutableRefObject<DailyRecord | null | undefined>;
  patchDailyRecord: (patch: DailyRecordPatch) => Promise<unknown>;
  actor: string;
  now?: () => Date;
  createId?: () => string;
  monotonicNow?: () => number;
}

const defaultNow = (): Date => new Date();
const defaultCreateId = (): string => crypto.randomUUID();

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
  actor,
  now = defaultNow,
  createId = defaultCreateId,
  monotonicNow = Date.now,
}: UseRayenSyncAuditInput) => {
  const activeRunRef = useRef<RayenSyncRun | null>(null);
  const runsRef = useRef(new Map<string, RayenSyncRun>());

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
      const stamped = applyRunToRecord(record, diff).record;
      const startedAt = monotonicNow();
      await patchDailyRecord({
        rayenSync: stamped.rayenSync,
        rayenSyncHistory: stamped.rayenSyncHistory,
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
    [applyRunToRecord, monotonicNow, patchDailyRecord, recordRunPerformance]
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
      const liveRecord = currentRecordRef.current;
      const base = liveRecord?.rayenSyncHistory?.some(event => event.id === runId)
        ? liveRecord
        : recordAtApply;
      const appliedEvent = base.rayenSyncHistory?.find(event => event.id === runId);
      if (!appliedEvent) {
        if (activeRunRef.current?.id === runId) activeRunRef.current = null;
        runsRef.current.delete(runId);
        return;
      }
      const coverage = buildRayenSyncCoverage(summary.total, summary.errors, now().toISOString());
      if (summary.incremental) coverage.incremental = summary.incremental;
      const completedEvent = completeRayenSyncEvent(
        appliedEvent,
        coverage,
        buildRayenStaffingObservation(staffingProposal),
        mergeRayenSyncPerformance(
          runsRef.current.get(runId)?.performance ?? appliedEvent.performance,
          summary.performance
        )
      );
      const history = upsertRayenSyncEvent(base.rayenSyncHistory, completedEvent);
      const patch: DailyRecordPatch = { rayenSyncHistory: history };
      if (base.rayenSync?.runId === runId) {
        patch.rayenSync = rayenSyncMetaFromEvent(completedEvent);
      }
      if (activeRunRef.current?.id === runId) activeRunRef.current = null;
      runsRef.current.delete(runId);
      await patchDailyRecord(patch);
    },
    [currentRecordRef, now, patchDailyRecord]
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
