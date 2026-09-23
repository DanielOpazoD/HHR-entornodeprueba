import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  runClinicalFill,
  type ClinicalFillDeps,
  type RayenHistoryScaleEvent,
  type RayenInvasiveDeviceEntry,
} from '@/features/rayen-import';
import { buildStructuralReviewEvidence } from '@/features/rayen-import/domain/clinicalStageResolution';
import {
  presentRayenSyncOutcome,
  presentRayenSyncRecovery,
} from '@/features/rayen-import/components/rayenSyncPresentation';
import { prepareRayenSyncTemporalContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import {
  receiveCorrelatedCapture,
  REPLAY_NOW,
  type SyntheticRayenCapture,
} from './deterministicClinicalReplay.fixtures';

interface ReplayEvidence {
  devicesByEpisode?: Record<string, RayenInvasiveDeviceEntry[]>;
  deviceErrorsByEpisode?: Record<string, string>;
  historyByEpisode?: Record<string, RayenHistoryScaleEvent[]>;
  formsByEpisode?: Record<string, unknown[]>;
  formsErrorByEpisode?: Record<string, string>;
}

interface ReplayResult {
  record: DailyRecord;
  target: Awaited<ReturnType<typeof prepareRayenSyncTemporalContext>>['target'];
  structural: ReturnType<typeof applyCensusImportDiff>;
  clinical: Awaited<ReturnType<typeof runClinicalFill>>;
  clinicalWrites: number;
  terminalEvent: NonNullable<DailyRecord['rayenSyncHistory']>[number];
  presentation: ReturnType<typeof presentRayenSyncOutcome>;
  recovery: ReturnType<typeof presentRayenSyncRecovery>;
}

let runSequence = 0;

export const replay = async (
  current: DailyRecord,
  capture: SyntheticRayenCapture,
  evidence: ReplayEvidence = {},
  now = REPLAY_NOW
): Promise<ReplayResult> => {
  const runId = `synthetic-replay-${++runSequence}`;
  const { snapshot, bundle } = receiveCorrelatedCapture(capture);
  let stored = current;
  const currentRecordRef: { current: DailyRecord } = { current: stored };
  const persistPatch = async (patch: DailyRecordPatch): Promise<void> => {
    stored = DailyRecordSchema.parse(
      JSON.parse(
        JSON.stringify(prepareDailyRecordForPersistence(applyPatches(stored, patch), current.date))
      )
    );
    currentRecordRef.current = stored;
  };
  let auditClockTick = 0;
  const audit = renderHook(() =>
    useRayenSyncAudit({
      currentRecordRef,
      patchDailyRecord: persistPatch,
      actor: 'Operador sintético',
      now: () => new Date(now.getTime() + auditClockTick++ * 1_000),
      createId: () => runId,
    })
  );
  const run = audit.result.current.startRun(undefined, undefined, {
    mode: 'preview',
    revision: 1,
    clinicalBatchMode: 'shadow',
  });
  const prepared = await prepareRayenSyncTemporalContext({
    displayedRecord: current,
    runId,
    loadFreshRecord: async () => current,
    now: () => now,
  });
  const reference = new Date(snapshot.capturedAt);
  const planned = reconcileCensus(prepared.record, snapshot, { reference });
  const diff =
    bundle.egresoRows.length > 0
      ? applyEgresoReport(planned, bundle.egresoRows, prepared.record)
      : planned;
  let movementSequence = 0;
  const structural = applyCensusImportDiff(prepared.record, diff, {
    idFactory: () => `${runId}-movement-${++movementSequence}`,
    now: reference,
    actor: 'Operador sintético',
    syncRunId: runId,
  });
  const applied = audit.result.current.applyRunToRecord(structural.record, diff);
  const confirmed = prepareDailyRecordForPersistence(applied.record, prepared.selectedDate);
  stored = DailyRecordSchema.parse(JSON.parse(JSON.stringify(confirmed)));
  currentRecordRef.current = stored;
  const handoff = resolveConfirmedRayenCensusHandoff(
    {
      record: stored,
      result: {
        date: prepared.selectedDate,
        outcome: 'clean',
        savedLocally: true,
        savedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        consistencyState: 'persisted_and_synced',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['synthetic_replay'],
        repairApplied: false,
        confirmedRecord: stored,
      },
    },
    { date: prepared.selectedDate, clinicalDay: prepared.target.clinicalDay, runId, diff }
  );
  const applyPatch = vi.fn(async (patch: DailyRecordPatch) => {
    await persistPatch(patch);
  });
  const deps: ClinicalFillDeps = {
    fetchDeviceReport: vi.fn(async (episodeId: string) => ({
      base64: '',
      ...(evidence.deviceErrorsByEpisode?.[episodeId]
        ? { error: evidence.deviceErrorsByEpisode[episodeId] }
        : evidence.devicesByEpisode?.[episodeId]
          ? { entries: evidence.devicesByEpisode[episodeId], source: 'json' as const }
          : {}),
    })),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn(async (episodeId: string) => ({
      events: evidence.historyByEpisode?.[episodeId] ?? [],
      nursingActivity: [],
      effectiveLookbackDays: 14,
      coverageWindowStartIsoDay: prepared.selectedDate,
      coverageWindowEndIsoDay: prepared.target.clinicalDay,
    })),
    fetchScalesForms: vi.fn(async (episodeId: string) => ({
      forms: evidence.formsByEpisode?.[episodeId] ?? [],
      error: evidence.formsErrorByEpisode?.[episodeId],
    })),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
    }),
    applyPatch,
    allowedClinicalEpisodeIds: handoff.safeClinicalEpisodeIds,
    now: () => now,
    createId: () => `${runId}-clinical`,
  };
  const clinical = await runClinicalFill(handoff.record, handoff.clinicalDay, deps);
  await audit.result.current.completeRun(handoff.record, clinical, null, run.id, {
    structuralReview: buildStructuralReviewEvidence(handoff),
  });
  const persistedTerminalEvent = stored.rayenSyncHistory?.find(event => event.id === runId);
  if (!persistedTerminalEvent) {
    throw new Error('El cierre terminal no sobrevivió a la persistencia del censo.');
  }
  audit.unmount();
  return {
    record: stored,
    target: prepared.target,
    structural,
    clinical,
    clinicalWrites: applyPatch.mock.calls.length,
    terminalEvent: persistedTerminalEvent,
    presentation: presentRayenSyncOutcome(persistedTerminalEvent),
    recovery: presentRayenSyncRecovery(persistedTerminalEvent, 'ready'),
  };
};
