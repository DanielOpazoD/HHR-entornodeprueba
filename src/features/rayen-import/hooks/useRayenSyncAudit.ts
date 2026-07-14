import { useCallback, useRef, type MutableRefObject } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { RayenSyncFailureReason, RayenSyncSource } from '@/types/domain/rayenSync';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { ClinicalFillSummary } from '../clinicalFillRunner';
import type { RayenExtensionHealthState } from './useRayenExtensionHealth';
import {
  buildAppliedRayenSyncEvent,
  buildFailedRayenSyncEvent,
  buildRayenSyncCoverage,
  completeRayenSyncEvent,
  rayenSyncMetaFromEvent,
  upsertRayenSyncEvent,
  type RayenSyncRun,
} from '../domain/rayenSyncHistory';

interface UseRayenSyncAuditInput {
  currentRecordRef: MutableRefObject<DailyRecord | null | undefined>;
  patchDailyRecord: (patch: DailyRecordPatch) => Promise<unknown>;
  actor: string;
  now?: () => Date;
  createId?: () => string;
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
  if (health.connection === 'blocked') return 'ficha_medico_unavailable';
  return 'extension_unavailable';
};

export const useRayenSyncAudit = ({
  currentRecordRef,
  patchDailyRecord,
  actor,
  now = defaultNow,
  createId = defaultCreateId,
}: UseRayenSyncAuditInput) => {
  const activeRunRef = useRef<RayenSyncRun | null>(null);

  const startRun = useCallback(
    (health?: RayenExtensionHealthState): RayenSyncRun => {
      const run: RayenSyncRun = {
        id: createId(),
        startedAt: now().toISOString(),
        by: actor,
        source: sourceFromHealth(health),
      };
      activeRunRef.current = run;
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
      await patchDailyRecord({
        rayenSync: stamped.rayenSync,
        rayenSyncHistory: stamped.rayenSyncHistory,
      });
      return stamped;
    },
    [applyRunToRecord, patchDailyRecord]
  );

  const completeRun = useCallback(
    async (recordAtApply: DailyRecord, summary: ClinicalFillSummary): Promise<void> => {
      const run = activeRunRef.current;
      if (!run) return;
      const liveRecord = currentRecordRef.current;
      const base = liveRecord?.rayenSyncHistory?.some(event => event.id === run.id)
        ? liveRecord
        : recordAtApply;
      const appliedEvent = base.rayenSyncHistory?.find(event => event.id === run.id);
      if (!appliedEvent) {
        activeRunRef.current = null;
        return;
      }
      const coverage = buildRayenSyncCoverage(summary.total, summary.errors, now().toISOString());
      const completedEvent = completeRayenSyncEvent(appliedEvent, coverage);
      const history = upsertRayenSyncEvent(base.rayenSyncHistory, completedEvent);
      const patch: DailyRecordPatch = { rayenSyncHistory: history };
      if (base.rayenSync?.runId === run.id || recordAtApply.rayenSync?.runId === run.id) {
        patch.rayenSync = rayenSyncMetaFromEvent(completedEvent);
      }
      activeRunRef.current = null;
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
      if (!record) return;
      const event = buildFailedRayenSyncEvent(run, reason, now().toISOString());
      await patchDailyRecord({
        rayenSyncHistory: upsertRayenSyncEvent(record.rayenSyncHistory, event),
      });
    },
    [currentRecordRef, now, patchDailyRecord]
  );

  const cancelRun = useCallback(() => {
    activeRunRef.current = null;
  }, []);

  return {
    startRun,
    ensureRun,
    applyRunToRecord,
    persistAppliedRun,
    completeRun,
    failRun,
    cancelRun,
  };
};
