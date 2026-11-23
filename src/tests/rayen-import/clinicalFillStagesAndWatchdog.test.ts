import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import {
  collectClinicalFillCandidates,
  countClinicalFillEligiblePatients,
} from '@/features/rayen-import/domain/clinicalFillCandidates';
import {
  CLINICAL_FILL_TIMEOUT_MESSAGE,
  RAYEN_CLINICAL_STAGE_TIMEOUT_MS,
  createClinicalFillWatchdog,
} from '@/features/rayen-import/domain/clinicalFillWatchdog';
import { createConcurrencyGate } from '@/features/rayen-import/domain/concurrencyGate';
import { createClinicalFillReaders } from '@/features/rayen-import/bridge/clinicalFillReaders';
import { requestEgresoLookup } from '@/features/rayen-import/bridge/rayenImportBridge';
import {
  classifyRayenSyncError,
  classifyRayenSyncIssueReason,
} from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import {
  RAYEN_FILL_STALE_AFTER_MS,
  beginRayenFill,
  endRayenFill,
  getRayenFillAttemptId,
  registerRayenFillAbort,
  resetRayenFillProgress,
} from '@/features/rayen-import/hooks/useRayenFillStatus';
import {
  STRUCTURAL_PERSIST_TIMEOUT_MESSAGE,
  runRayenStructuralPersistenceLifecycle,
} from '@/features/rayen-import/hooks/rayenSnapshotPersistenceExecution';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import { applyPatches } from '@/utils/patchUtils';
import { asStoredDailyRecordShape, DataFactory } from '@/tests/factories/DataFactory';

describe('clinicalFillCandidates', () => {
  const candidateRecord = asStoredDailyRecordShape({
    date: '2026-07-28',
    beds: {
      H1C1: {
        bedId: 'H1C1',
        patientName: 'Paciente seguro',
        clinicalEpisodeId: 'episode-safe',
        clinicalCrib: {
          bedId: 'H1C1',
          patientName: 'RN seguro',
          clinicalEpisodeId: 'episode-crib',
        },
      },
      H2C1: {
        bedId: 'H2C1',
        patientName: 'Paciente en conflicto',
        clinicalEpisodeId: 'episode-blocked',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-28T10:00:00.000Z',
  });

  it('limits enrichment to structurally confirmed episodes, including an allowed crib', () => {
    const allowed = ['episode-safe', 'episode-crib'];

    expect(collectClinicalFillCandidates(candidateRecord, allowed)).toEqual([
      expect.objectContaining({ bedId: 'H1C1', clinicalCrib: false }),
      expect.objectContaining({ bedId: 'H1C1', clinicalCrib: true }),
    ]);
    expect(countClinicalFillEligiblePatients(candidateRecord, allowed)).toBe(2);
  });

  it('preserves the legacy all-eligible behavior when no structural filter is provided', () => {
    expect(countClinicalFillEligiblePatients(candidateRecord)).toBe(3);
  });
});

describe('clinical fill fixed point', () => {
  const BED_IDS = ['R1', 'R2', 'R3', 'R4', 'H1C1', 'H1C2', 'H2C1', 'H2C2', 'H3C1', 'H4C1'];
  const HISTORY_EVENT = {
    publishDatetime: '2026-07-10T08:00:00',
    evaluationInstrumentsResume: [
      { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
      {
        FORM_NAME: 'Escala de riesgo UPP (Braden)',
        LABEL: 'Nivel de Severidad',
        VALUE: 'Riesgo bajo',
      },
    ],
  };

  const buildRecord = (): DailyRecord =>
    asStoredDailyRecordShape({
      date: '2026-07-10',
      beds: Object.fromEntries(
        BED_IDS.map((bedId, index) => [
          bedId,
          {
            bedId,
            patientName: `Paciente ${index + 1}`,
            clinicalEpisodeId: `E${index + 1}`,
            devices: [],
          },
        ])
      ),
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '2026-07-10T12:00:00.000Z',
    });

  const buildDeps = (applyPatch: ClinicalFillDeps['applyPatch']): ClinicalFillDeps => ({
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({
      events: [HISTORY_EVENT],
      nursingActivity: [],
      effectiveLookbackDays: 14,
      coverageWindowStartIsoDay: '2026-06-28',
      coverageWindowEndIsoDay: '2026-07-09',
    }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
    }),
    applyPatch,
    now: () => new Date('2026-07-10T12:00:00.000Z'),
    createId: () => 'unused-id',
  });

  it('budgets an identical retry at zero patches, writes and snapshots after hydration', async () => {
    const initialRecord = buildRecord();
    let aggregatePatch: DailyRecordPatch = {};
    const firstApply = vi.fn(async (patch: DailyRecordPatch) => {
      aggregatePatch = { ...aggregatePatch, ...patch };
    });
    const first = await runClinicalFill(initialRecord, '2026-07-10', buildDeps(firstApply));
    const persisted = prepareDailyRecordForPersistence(
      applyPatches(initialRecord, aggregatePatch),
      '2026-07-10'
    );
    const hydrated = JSON.parse(JSON.stringify(persisted)) as DailyRecord;

    const retryApply = vi.fn().mockResolvedValue(undefined);
    const retry = await runClinicalFill(hydrated, '2026-07-10', buildDeps(retryApply));

    expect(first.incremental).toMatchObject({ patientWrites: 1, historySnapshots: 1 });
    expect(retry).toMatchObject({ total: 10, patched: 0, errors: [] });
    expect(retry.incremental).toMatchObject({ patientWrites: 0, historySnapshots: 0 });
    expect(retry.performance?.counters.patches).toBe(0);
    expect(retryApply).not.toHaveBeenCalled();
  });
});

describe('stage-bound clinical readers', () => {
  const readers = (signal: AbortSignal) => {
    const api = createClinicalFillReaders(signal);
    return [
      () => api.fetchDeviceReport('episode', '2026-09-27'),
      () => api.fetchHistoryScales('episode', '2026-09-27', { lookbackDays: 7 }),
      () => api.fetchScalesForms('episode'),
      () => api.fetchPatientClinicalBundle('episode', '2026-09-27', {}),
      () => api.fetchCudyrCategories(),
    ];
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('cancels the authorization capture with its clinical stage', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const api = createClinicalFillReaders(controller.signal, [
      {
        bedId: 'R1',
        clinicalCrib: false,
        patient: {
          patientName: 'Paciente sintético',
          rut: '12.345.678-5',
          clinicalEpisodeId: '142040',
        } as PatientData,
      },
    ]);
    const first = api.fetchScalesForms('142040');
    const request = post.mock.calls[0][0];
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_SCALES_REPORT_RESULT',
          reqId: request.reqId,
          forms: [],
          error: 'Las escalas no fueron autorizadas para el episodio de esta pestaña.',
        },
      })
    );
    await first;
    const retry = api.fetchScalesForms('142040');
    expect(post.mock.calls[1][0].type).toBe('HHR_RAYEN_REQUEST_SYNC_BUNDLE');
    controller.abort();
    await expect(retry).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an exact-episode lookup without leaving its bridge timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const pending = requestEgresoLookup(
      [{ run: '123456785', encounterId: '142040' }],
      undefined,
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels all five in-flight page channels promptly with no timers left', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const results = Promise.allSettled(readers(controller.signal).map(read => read()));
    expect(post).toHaveBeenCalledTimes(5);
    controller.abort(new DOMException('Stage cancelled', 'AbortError'));
    expect(await results).toEqual(
      Array.from({ length: 5 }, () => ({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' }),
      }))
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows the worker backend deadline to elapse before timing out individual channels', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const done = vi.fn();
    const pending = Promise.all(readers(controller.signal).map(read => read().then(done)));
    await vi.advanceTimersByTimeAsync(50_000);
    expect(done).not.toHaveBeenCalled();
    for (const [request] of post.mock.calls) {
      const type = String(request.type).replace(/_REQUEST$/, '_RESULT');
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            type,
            reqId: request.reqId,
            items: [],
            events: [],
            forms: [],
            devices: { entries: [] },
            history: { events: [] },
            base64: '',
          },
        })
      );
    }
    await pending;
    expect(done).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('closing a sync run after its clinical save', () => {
  const SCALE_EVENT = {
    publishDatetime: '2026-07-10T10:00:00',
    evaluationInstrumentsResume: [
      { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
    ],
  };

  const buildCloseRecord = (): DailyRecord =>
    DataFactory.createMockDailyRecord('2026-07-10', {
      beds: {
        R1: {
          ...createEmptyPatient('R1'),
          patientName: 'Paciente Sintético',
          rut: '12.345.678-5',
          clinicalEpisodeId: 'E1',
          devices: [],
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
    });

  const setup = (archiveResult: 'persisted' | 'failed') => {
    let clock = 0;
    const events: string[] = [];
    let releaseArchive: (() => void) | undefined;
    const deps: ClinicalFillDeps = {
      monotonicNow: () => clock,
      fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [SCALE_EVENT], nursingActivity: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
        observedEpisodeIds: ['E1'],
        metadataStatus: 'complete',
      }),
      recoverCudyrPlacements: vi.fn(async () => {
        clock += 100;
        return [];
      }),
      archiveCudyrCapture: vi.fn(
        () =>
          new Promise<'persisted' | 'failed'>(resolve => {
            releaseArchive = () => {
              events.push('archive');
              resolve(archiveResult);
            };
          })
      ),
      applyPatch: vi.fn(async () => {
        clock += 1000;
        events.push('save');
      }),
      registerStaff: vi.fn(async observations => {
        clock += 300;
        events.push('staff');
        return observations;
      }),
      now: () => new Date('2026-07-10T12:00:00.000Z'),
      createId: () => '00000000-0000-4000-8000-000000000001',
    };
    return {
      deps,
      events,
      finishArchive: (afterMs: number) => {
        clock += afterMs;
        releaseArchive?.();
      },
    };
  };

  it('registers staff after the save, closes only once the CUDYR archive settles and measures each part', async () => {
    const { deps, events, finishArchive } = setup('persisted');
    let closed = false;
    const run = runClinicalFill(buildCloseRecord(), '2026-07-10', deps).then(summary => {
      closed = true;
      return summary;
    });

    await vi.waitFor(() => expect(events).toEqual(['save', 'staff']));
    expect(deps.archiveCudyrCapture).toHaveBeenCalledOnce();
    expect(closed).toBe(false);

    finishArchive(2000);
    const summary = await run;

    expect(events).toEqual(['save', 'staff', 'archive']);
    expect(summary.errors).toEqual([]);
    expect(summary.patched).toBe(1);
    const stages = summary.performance!.stagesMs;
    expect(stages.closeWait).toBe(2300);
    expect(stages.staffRegistration).toBe(300);
    expect(stages.cudyrArchivePlacementReads).toBe(100);
    expect(stages.cudyrArchiveWrites).toBeGreaterThanOrEqual(2300);
    expect(stages.cudyrArchive).toBeGreaterThanOrEqual(stages.cudyrArchiveWrites! + 100);
    expect(JSON.stringify(summary.performance)).not.toMatch(/Sintético|E1|R1|12\.345/);
  });

  it('still reports a failed archive part as the same run error, with the wait measured', async () => {
    const { deps, events, finishArchive } = setup('failed');
    const run = runClinicalFill(buildCloseRecord(), '2026-07-10', deps);
    await vi.waitFor(() => expect(events).toEqual(['save', 'staff']));
    finishArchive(500);
    const summary = await run;

    expect(summary.errors).toMatchObject([
      { clinicalEpisodeId: 'E1', source: 'cudyr', reason: 'historical_archive_failed' },
    ]);
    expect(summary.performance!.stagesMs.closeWait).toBe(800);
  });

  it('leaves the archive unmeasured, never zero, when the run archives nothing', async () => {
    const { deps } = setup('persisted');
    const summary = await runClinicalFill(buildCloseRecord(), '2026-07-10', {
      ...deps,
      archiveCudyrCapture: undefined,
    });

    const stages = summary.performance!.stagesMs;
    expect(stages.staffRegistration).toBe(300);
    expect(stages.closeWait).toBe(300);
    expect(stages).not.toHaveProperty('cudyrArchive');
    expect(stages).not.toHaveProperty('cudyrArchivePlacementReads');
    expect(stages).not.toHaveProperty('cudyrArchiveWrites');
  });
});

describe('clinical fill watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetRayenFillProgress(Date.now() + RAYEN_FILL_STALE_AFTER_MS * 2);
  });

  it('aborts the stage after the ceiling and reports a timeout, never a concurrency conflict', () => {
    const onTimeout = vi.fn();
    const watchdog = createClinicalFillWatchdog({ onTimeout });

    vi.advanceTimersByTime(RAYEN_CLINICAL_STAGE_TIMEOUT_MS - 1);
    expect(watchdog.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);

    expect(watchdog.signal.aborted).toBe(true);
    expect(onTimeout).toHaveBeenCalledOnce();
    const reason = watchdog.signal.reason as Error;
    expect(reason.message).toBe(CLINICAL_FILL_TIMEOUT_MESSAGE);
    expect(classifyRayenSyncError(reason)).toBe('timeout');
    expect(classifyRayenSyncIssueReason('devices', reason)).toBe('source_timeout');
  });

  it('settle() disarms the timer and abort() is idempotent', () => {
    const onTimeout = vi.fn();
    const watchdog = createClinicalFillWatchdog({ timeoutMs: 1_000, onTimeout });
    watchdog.settle();
    vi.advanceTimersByTime(5_000);
    expect(watchdog.signal.aborted).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();

    watchdog.abort();
    watchdog.abort();
    expect(watchdog.signal.aborted).toBe(true);
  });

  it('closes the concurrency gate for reads queued behind it once aborted', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    const gate = createConcurrencyGate(1, controller.signal);
    let releaseFirst: (() => void) | null = null;
    const first = gate(
      () => new Promise<string>(resolve => (releaseFirst = () => resolve('first')))
    );
    const second = gate(async () => 'second');
    await vi.waitFor(() => expect(releaseFirst).not.toBeNull());

    controller.abort(new Error('Clinical stage timeout'));
    releaseFirst!();

    await expect(first).resolves.toBe('first');
    await expect(second).rejects.toThrow('Clinical stage timeout');
  });

  it('lets the stale single-flight lock stop the worker instead of only freeing the button', () => {
    vi.useRealTimers();
    const t0 = 1_000_000;
    const abort = vi.fn();
    expect(beginRayenFill(3, t0)).toBe(true);
    registerRayenFillAbort(abort, getRayenFillAttemptId());

    expect(beginRayenFill(3, t0 + RAYEN_FILL_STALE_AFTER_MS - 1)).toBe(false);
    expect(abort).not.toHaveBeenCalled();

    expect(beginRayenFill(3, t0 + RAYEN_FILL_STALE_AFTER_MS + 1)).toBe(true);
    expect(abort).toHaveBeenCalledOnce();
    endRayenFill(0, false, getRayenFillAttemptId());
  });
});

describe('structural persistence watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails the run with a timeout when the structural write never settles', async () => {
    const finishFailedPersistence = vi.fn();
    const continueAfterCommit = vi.fn();
    const pending = runRayenStructuralPersistenceLifecycle({
      executionKey: 'run-hang',
      activeExecutionKeys: new Set(),
      isCurrent: () => true,
      startPersistence: vi.fn(),
      persist: (() => new Promise(() => undefined)) as never,
      continueAfterCommit,
      finishFailedPersistence,
      persistTimeoutMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ kind: 'failed' });
    expect(continueAfterCommit).not.toHaveBeenCalled();
    const error = finishFailedPersistence.mock.calls[0]?.[0] as Error;
    expect(error.message).toBe(STRUCTURAL_PERSIST_TIMEOUT_MESSAGE);
    expect(classifyRayenSyncError(error)).toBe('timeout');
  });
});
