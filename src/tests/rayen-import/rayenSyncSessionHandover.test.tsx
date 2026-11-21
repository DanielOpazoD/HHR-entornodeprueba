import Dexie from 'dexie';
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useRayenSnapshotPreview } from '@/features/rayen-import/hooks/useRayenSnapshotPreview';
import { useRayenImportConfirmation } from '@/features/rayen-import/hooks/useRayenImportConfirmation';
import { useRayenCensusDiffApplication } from '@/features/rayen-import/hooks/useRayenCensusDiffApplication';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { useRayenSyncExecutionController } from '@/features/rayen-import/hooks/useRayenSyncExecutionController';
import { createRayenSyncPersistenceQueue } from '@/features/rayen-import/hooks/rayenSyncPersistenceQueue';
import { INITIAL_RAYEN_IMPORT_STATE } from '@/features/rayen-import/hooks/rayenImportState';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import {
  captureFor,
  emptyRecordFor,
  patientAt,
  syntheticEncounter,
} from './deterministicClinicalReplay.fixtures';

/**
 * A shared computer: A starts a sync while the write queue is busy, the view unmounts and B signs
 * in (or A's session changes generation). When the queue frees, A's run must write nothing more,
 * enter no clinical stage and never close the history in the new session's name; a structure that
 * was already committed keeps its `applied` event. Real hooks, queue, audit and clinical stage over
 * Dexie; only the Eloísa planner and the clinical source read are synthetic.
 */

const ports = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock('@/features/rayen-import/hooks/prepareRayenStructuralPlan', () => ({
  prepareRayenStructuralPlan: ports.plan,
}));
vi.mock('@/features/rayen-import/hooks/useTreatingPhysicianCatalogSync', () => ({
  useTreatingPhysicianCatalogSync: () => (snapshot: unknown) => snapshot,
}));
vi.mock('@/features/rayen-import/hooks/rayenSnapshotPreviewPreparation', async original => ({
  ...(await original<
    typeof import('@/features/rayen-import/hooks/rayenSnapshotPreviewPreparation')
  >()),
  prepareRayenSnapshotEvidence: () => ({
    valid: true,
    isHistoricalDay: false,
    reportDate: '2026-08-15',
  }),
}));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: vi.fn(),
}));
// The discharged patient has no Eloísa clinical source to read; the fill itself stays real.
vi.mock('@/features/rayen-import/clinicalFillRunner', async original => {
  const real = await original<typeof import('@/features/rayen-import/clinicalFillRunner')>();
  return {
    ...real,
    runClinicalFill: async (
      record: DailyRecord,
      ...args: Parameters<typeof real.runClinicalFill> extends [unknown, ...infer Rest]
        ? Rest
        : never
    ) =>
      record.discharges.length > 0
        ? { total: 0, patched: 0, errors: [] }
        : real.runClinicalFill(record, ...args),
  };
});

const date = '2026-08-15';
const runId = 'synthetic-run';
const requestId = 'synthetic-request';
const policy = { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' } as const;
const noChange = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
} as CensusImportDiff;
const patient = patientAt(syntheticEncounter('departing'), 'H1C1');
const reviewedDischarge = {
  ...noChange,
  discharges: [
    {
      bedId: 'H1C1',
      patientName: patient.patientName,
      rut: patient.rut,
      encounterId: patient.clinicalEpisodeId,
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
      correctedDay: date,
      correctedTime: '18:30',
    },
  ],
  summary: { ...noChange.summary, discharges: 1 },
} as unknown as CensusImportDiff;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const admit = (owner: string, generation: string) => {
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  setSessionGeneration(generation, owner);
};

const sessionLabel = () => {
  const { session } = guardAuthoringSession();
  return `${session.ownerKey}/${session.generation}`;
};

type Route = 'automatic' | 'reviewed';
type Handover =
  | 'none'
  | 'owner'
  | 'generation'
  | 'day-turn-owner'
  | 'day-turn-generation'
  | 'after-commit';

const runSync = async (route: Route, handover: Handover) => {
  const base = emptyRecordFor(date, { beds: route === 'reviewed' ? { H1C1: patient } : {} });
  const plan = route === 'reviewed' ? reviewedDischarge : noChange;
  ports.plan.mockResolvedValue({ diff: plan, replanDiff: async () => plan });
  const db = new Dexie(`rayen-session-handover-${route}-${handover}`);
  db.version(1).stores({ days: 'date' });
  const days = db.table<DailyRecord, string>('days');
  await days.put(base);
  const queue = createRayenSyncPersistenceQueue();
  const queueBusy = deferred();
  const queueEntered = deferred();
  const committed = deferred();
  const releaseAfterCommit = deferred();
  const dayTurnBusy = deferred();
  const dayTurnRequested = deferred();
  const queryClient = new QueryClient();
  if (handover === 'after-commit') {
    // Pause after the structural write, while the census cache is still being refreshed.
    const cancelQueries = queryClient.cancelQueries.bind(queryClient);
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async (...args) => {
      await cancelQueries(...args);
      committed.resolve();
      await releaseAfterCommit.promise;
    });
  }
  const writes: string[] = [];
  const live = { current: base };
  const preparedSyncContextRef = {
    current: {
      runId,
      selectedDate: date,
      record: base,
      target: { clinicalDay: date, kind: 'current' },
      range: { dateStart: date, dateEnd: date },
    },
  };
  const selectedDateRef = { current: date };
  const structuralReplanRef = { current: null };
  const structuralPersistenceExecutionKeysRef = { current: new Set<string>() };
  const write = async (record: DailyRecord, label: string) => {
    writes.push(`${label}+${record.rayenSyncHistory?.[0]?.status}@${sessionLabel()}`);
    await days.put(record);
    live.current = record;
    return {
      date,
      state: 'confirmed',
      savedHere: true,
      localCopy: 'current',
      confirmedRecord: record,
    };
  };
  const hook = renderHook(() => {
    const [state, setState] = useState(INITIAL_RAYEN_IMPORT_STATE);
    const controller = useRayenSyncExecutionController({
      importState: state,
      setImportState: setState,
    });
    const audit = useRayenSyncAudit({
      currentRecordRef: live,
      actor: 'owner-A',
      createId: () => runId,
      patchDailyRecord: async ({ partial }: { partial: Partial<DailyRecord> }) => {
        writes.push(`history-${partial.rayenSyncHistory?.[0]?.status}@${sessionLabel()}`);
        await days.update(date, partial);
        live.current = (await days.get(date)) as DailyRecord;
      },
    } as never);
    const applyDiff = useRayenCensusDiffApplication({
      ensureRun: audit.ensureRun,
      applyRunToRecord: audit.applyRunToRecord,
      queryClient,
      saveDailyRecord: async (record: DailyRecord) => ({
        record,
        result: await write(record, 'structure'),
      }),
      checkpointRepository: {
        updatePartialDetailed: async (_date: string, patch: Partial<DailyRecord>) =>
          write({ ...((await days.get(date)) as DailyRecord), ...patch }, 'checkpoint'),
      },
      loadLocalRecord: async () => ({
        record: await days.get(date),
        hasPendingWrites: false,
        hasPendingWritesForDate: false,
        writeState: 'none',
      }),
      loadAuthoritativeRecord: async () => (await days.get(date)) as DailyRecord,
      recordRunPerformance: audit.recordRunPerformance,
    } as never);
    const fill = useRayenClinicalFill({
      nurseCatalog: [],
      tensCatalog: [],
      loadDailyRecord: () => days.get(date),
      completeRun: audit.completeRun,
      onStaffingProposal: () => undefined,
      createId: () => runId,
    } as never);
    const common = {
      setState: controller.setImportStateCurrent,
      dispatchExecution: controller.dispatchExecution,
      executionRef: controller.executionRef,
      selectedDateRef,
      preparedSyncContextRef: preparedSyncContextRef as never,
      structuralReplanRef,
      structuralPersistenceExecutionKeysRef,
      ensureRun: audit.ensureRun,
      failRun: (...args: Parameters<typeof audit.failRun>) =>
        queue.run(() => audit.failRun(...args)),
      applyDiff: (...args: Parameters<typeof applyDiff>) => {
        dayTurnRequested.resolve();
        return applyDiff(...args);
      },
      runSerializedPersistence: <T,>(operation: () => Promise<T>) => {
        queueEntered.resolve();
        return queue.run(operation);
      },
      isAdmin: true,
      dailyRecord: {} as never,
      recordRunPerformance: audit.recordRunPerformance,
      loadAuthoritativeStructuralRecord: async () => base,
      runClinicalStage: async (request: Parameters<typeof fill>[0]) => {
        writes.push(`clinical@${sessionLabel()}`);
        const result = await fill(request);
        controller.finishClinicalSync(result, runId);
        return result;
      },
    };
    const preview = useRayenSnapshotPreview({
      ...common,
      getRun: audit.getRun,
      clearSyncTimeout: () => undefined,
      loadInvalidEpisodeIds: async () => new Set<string>(),
    });
    const confirm = useRayenImportConfirmation({
      ...common,
      state,
      currentRecord: base,
      currentRecordRef: live,
      queryClient,
    });
    return { controller, audit, preview, confirm, state };
  });
  try {
    act(() => {
      hook.result.current.audit.startRun(undefined, undefined, policy as never);
      hook.result.current.controller.dispatchExecution({
        type: 'prepare',
        runId,
        selectedDate: date,
      });
      hook.result.current.controller.dispatchExecution({
        type: 'activate',
        context: { runId, requestId, selectedDate: date, clinicalDay: date, policy } as never,
      });
    });
    const { snapshot, bundle } = captureFor(date, []);
    const preview = () => hook.result.current.preview(snapshot, bundle, runId, requestId);
    if (route === 'reviewed') {
      await act(async () => preview());
      expect(hook.result.current.controller.executionRef.current.stage?.type).toBe(
        'awaiting_review'
      );
    }
    const blocker = queue.run(() => queueBusy.promise);
    // Another edit of the same day holds its write turn while the run leaves the Eloísa queue.
    const dayEdit = handover.startsWith('day-turn')
      ? runExclusiveDailyRecordWrite(date, () => dayTurnBusy.promise)
      : Promise.resolve();
    let work!: Promise<void>;
    await act(async () => {
      work = route === 'reviewed' ? hook.result.current.confirm() : preview();
      await Promise.race([
        queueEntered.promise,
        work.then(() => {
          throw new Error(
            `The run ended before the write queue: ${JSON.stringify({
              stage: hook.result.current.controller.executionRef.current.stage,
              error: hook.result.current.state.error,
            })}`
          );
        }),
      ]);
    });
    if (handover === 'owner' || handover === 'generation') {
      const startedBy = guardAuthoringSession();
      hook.unmount();
      admit(handover === 'owner' ? 'owner-B' : 'owner-A', 'second');
      expect(startedBy.isCurrent()).toBe(false);
    }
    queueBusy.resolve();
    if (handover === 'day-turn-owner' || handover === 'day-turn-generation') {
      await dayTurnRequested.promise;
      hook.unmount();
      admit(handover === 'day-turn-owner' ? 'owner-B' : 'owner-A', 'second');
      dayTurnBusy.resolve();
    }
    if (handover === 'after-commit') {
      await committed.promise;
      hook.unmount();
      admit('owner-B', 'second');
      releaseAfterCommit.resolve();
    }
    await act(async () => {
      await blocker;
      await dayEdit;
      await work;
      await queue.run(async () => undefined);
    });
    const day = (await days.get(date)) as DailyRecord;
    return {
      writes,
      history: (day.rayenSyncHistory ?? []).map(event => event.status),
      discharges: day.discharges.length,
    };
  } finally {
    queueBusy.resolve();
    dayTurnBusy.resolve();
    releaseAfterCommit.resolve();
    hook.unmount();
    await db.delete();
  }
};

beforeEach(() => admit('owner-A', 'first'));
afterEach(() => {
  localStorage.removeItem(SESSION_OWNER_KEY);
  setSessionGeneration(null);
});

describe('Eloísa sync stops when the session changes while it waits for the write queue', () => {
  it.each([
    ['automatic', 'checkpoint', 0],
    ['reviewed', 'structure', 1],
  ] as const)(
    '%s route without a session change saves and closes the run in the starting session',
    async (route, write, discharges) => {
      await expect(runSync(route, 'none')).resolves.toEqual({
        writes: [
          `${write}+applied@owner-A/first`,
          'clinical@owner-A/first',
          'history-complete@owner-A/first',
        ],
        history: ['complete'],
        discharges,
      });
    }
  );

  it.each([
    ['automatic', 'owner'],
    ['automatic', 'generation'],
    ['reviewed', 'owner'],
    ['reviewed', 'generation'],
  ] as const)(
    '%s route, %s change: writes nothing and enters no clinical stage',
    async (route, handover) => {
      await expect(runSync(route, handover)).resolves.toEqual({
        writes: [],
        history: [],
        discharges: 0,
      });
    }
  );

  it.each([
    ['automatic', 'day-turn-owner'],
    ['automatic', 'day-turn-generation'],
    ['reviewed', 'day-turn-owner'],
    ['reviewed', 'day-turn-generation'],
  ] as const)(
    '%s route, change (%s) while another edit holds the day: writes nothing',
    async (route, handover) => {
      await expect(runSync(route, handover)).resolves.toEqual({
        writes: [],
        history: [],
        discharges: 0,
      });
    }
  );

  it('a change after the structural commit keeps its applied event and stops before clinical', async () => {
    await expect(runSync('automatic', 'after-commit')).resolves.toEqual({
      writes: ['checkpoint+applied@owner-A/first'],
      history: ['applied'],
      discharges: 0,
    });
  });
});
