import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
  RayenSyncBundle,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import {
  visibleErrorTechnicalDetail,
  type RayenImportState,
} from '@/features/rayen-import/hooks/rayenImportState';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { errorService } from '@/services/utils/errorService';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { useRayenSnapshotPreview } from '@/features/rayen-import/hooks/useRayenSnapshotPreview';

// The real planner runs: the snapshot preview, the structural plan and its replan. Only the
// extension edges (the evidence client) and the catalog side effect are simulated. Episode 111 is
// in HHR but absent from a complete Ficha capture, so the plan asks Gestión de Camas about it.
const evidence = vi.hoisted(() => ({
  lookupEgresos: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/rayenSnapshotEvidenceClient', () => ({
  createRayenSnapshotEvidenceClient: () => ({
    lookupEgresos: evidence.lookupEgresos,
    fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    lookupHospitalizations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@/features/rayen-import/hooks/useTreatingPhysicianCatalogSync', () => ({
  useTreatingPhysicianCatalogSync: () => (snapshot: unknown) => snapshot,
}));

// The capture clock is not under test: the evidence belongs to the requested census.
vi.mock('@/features/rayen-import/hooks/rayenSnapshotPreviewPreparation', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/features/rayen-import/hooks/rayenSnapshotPreviewPreparation')
  >()),
  prepareRayenSnapshotEvidence: () => ({
    valid: true,
    isHistoricalDay: false,
    reportDate: '2026-07-08',
  }),
}));

const reference = new Date('2026-07-08T20:00:00-06:00');

const encounter = (encounterId: string, run: string, bed: string): RayenEncounter => ({
  encounterId,
  run,
  firstGivenName: 'Paciente',
  firstFamilyName: `Sintético ${encounterId}`,
  birthDate: '1990-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H4',
  bed,
  admissionDatetime: '2026-07-08T10:00:00-06:00',
});
const absent = encounter('111', '11.111.111-1', 'C1');
const present = encounter('222', '22.222.222-2', 'C2');

const record = {
  date: '2026-07-08',
  beds: {
    H4C1: { ...rayenToPatientData(absent, reference).patient, bedId: 'H4C1' },
    H4C2: { ...rayenToPatientData(present, reference).patient, bedId: 'H4C2' },
  },
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-07-08T10:00:00.000Z',
} as unknown as DailyRecord;

const snapshot: RayenCensusSnapshot = {
  capturedAt: reference.toISOString(),
  facilityId: 1342,
  encounters: [present],
  isComplete: true,
};

const bundle = {
  facilityId: 1342,
  fichaMedicoCapturedAt: snapshot.capturedAt,
  dateStart: record.date,
  dateEnd: record.date,
  egresoRows: [],
} as unknown as RayenSyncBundle;

const initialState: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  result: null,
  hasSkippedItems: false,
  error: null,
};

const renderPreview = (dailyRecord: Partial<DailyRecordRepositoryPort>) => {
  const setState = vi.fn();
  const dispatchExecution = vi.fn();
  const failRun = vi.fn().mockResolvedValue(undefined);
  const applyDiff = vi.fn();
  const runClinicalStage = vi.fn();
  const context = {
    runId: 'run-1',
    record,
    selectedDate: record.date,
    target: {
      kind: 'current' as const,
      calendarDay: record.date,
      clinicalDay: record.date,
      lookbackDays: 0,
    },
    range: { dateStart: record.date, dateEnd: record.date },
    preparedAt: reference.toISOString(),
  };
  const preparedSyncContextRef = { current: context as typeof context | null };
  const executionRef = {
    current: {
      context: { runId: 'run-1', requestId: 'request-1', selectedDate: record.date },
      pending: { runId: 'run-1', selectedDate: record.date },
      stage: { type: 'planning_structure' },
      outcome: { structuralConflicts: 0, skippedItems: 0 },
    },
  };
  const run = {
    id: 'run-1',
    sourceDate: record.date,
    startedAt: reference.toISOString(),
    by: 'Operador HHR',
    policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 },
  };
  const hook = renderHook(() =>
    useRayenSnapshotPreview({
      dailyRecord: dailyRecord as DailyRecordRepositoryPort,
      isAdmin: false,
      setState,
      dispatchExecution,
      executionRef: executionRef as never,
      selectedDateRef: { current: record.date },
      clearSyncTimeout: vi.fn(),
      applyDiff: applyDiff as never,
      runClinicalStage,
      failRun,
      ensureRun: vi.fn().mockReturnValue(run),
      getRun: vi.fn().mockReturnValue(run),
      recordRunPerformance: vi.fn(),
      preparedSyncContextRef: preparedSyncContextRef as never,
      structuralReplanRef: { current: null },
      structuralPersistenceExecutionKeysRef: { current: new Set<string>() },
      runSerializedPersistence: operation => operation(),
      loadAuthoritativeStructuralRecord: vi.fn(),
      loadInvalidEpisodeIds: vi.fn().mockResolvedValue(new Set<string>()),
    })
  );
  const visibleState = (): RayenImportState =>
    setState.mock.calls.reduce(
      (state, [update]) => (typeof update === 'function' ? update(state) : update),
      initialState
    );
  const stages = () =>
    dispatchExecution.mock.calls
      .map(([action]) => action)
      .filter(action => action.type === 'transition')
      .map(action => action.stage.type);
  const preview = async () => {
    await act(async () => {
      await hook.result.current(snapshot, bundle, 'run-1', 'request-1');
    });
  };
  return {
    preview,
    visibleState,
    stages,
    failRun,
    applyDiff,
    runClinicalStage,
    preparedSyncContextRef,
  };
};

const readableDays = () => ({
  getForDate: vi.fn().mockResolvedValue(null),
  getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
});

const PLANNING_UNFINISHED = 'La conciliación del censo quedó sin terminar. Vuelve a sincronizar.';

describe('structural planning that fails part way through a synchronization', () => {
  afterEach(() => {
    setSessionGeneration(null);
    errorService.clearErrors();
    vi.restoreAllMocks();
  });

  it('ends the run with a calm line, saving nothing and discharging no one, when the episode lookup rejects', async () => {
    evidence.lookupEgresos.mockReset();
    evidence.lookupEgresos.mockImplementation(async (targets: Array<{ encounterId: string }>) => {
      if (targets.length === 0) return [];
      throw new TypeError("Cannot read properties of undefined (reading 'encounterId')");
    });
    const logged = vi.spyOn(errorService, 'logError').mockImplementation(() => undefined);
    const harness = renderPreview(readableDays());

    await harness.preview();

    expect(
      evidence.lookupEgresos.mock.calls.flatMap(([targets]) =>
        targets.map((target: { encounterId: string }) => target.encounterId)
      )
    ).toEqual(['111']);
    expect(harness.stages()).toEqual(['planning_structure', 'failed']);
    expect(harness.failRun).toHaveBeenCalledWith('apply_failed', 'run-1');
    const state = harness.visibleState();
    expect(state.error).toBe(PLANNING_UNFINISHED);
    // The source text is for the administrator only, and the failure stays diagnosable.
    expect(visibleErrorTechnicalDetail(state, false)).toBeNull();
    expect(visibleErrorTechnicalDetail(state, true)).toContain('Cannot read properties');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[0]).toMatchObject({
      message: 'Rayen structural planning failed',
      error: expect.any(TypeError),
    });
    expect(harness.applyDiff).not.toHaveBeenCalled();
    expect(harness.runClinicalStage).not.toHaveBeenCalled();
    expect(harness.preparedSyncContextRef.current).toBeNull();
  });

  it('keeps a refused permission out of the message a non-administrator reads', async () => {
    evidence.lookupEgresos.mockReset();
    evidence.lookupEgresos.mockResolvedValue([]);
    vi.spyOn(errorService, 'logError').mockImplementation(() => undefined);
    const dailyRecord = readableDays();
    dailyRecord.getAuthoritativeForDate.mockRejectedValue(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      })
    );
    const harness = renderPreview(dailyRecord);

    await harness.preview();

    const state = harness.visibleState();
    expect(state.error).toBe(PLANNING_UNFINISHED);
    expect(visibleErrorTechnicalDetail(state, false)).toBeNull();
    expect(visibleErrorTechnicalDetail(state, true)).toBe('Missing or insufficient permissions.');
  });

  it('shows the remedy the reconciliation itself wrote when it stops on purpose', async () => {
    evidence.lookupEgresos.mockReset();
    evidence.lookupEgresos.mockResolvedValue([]);
    const logged = vi.spyOn(errorService, 'logError').mockImplementation(() => undefined);
    const dailyRecord = readableDays();
    // The previous census arrives under another date.
    dailyRecord.getAuthoritativeForDate.mockResolvedValue({ ...record, date: '2026-07-01' });
    const harness = renderPreview(dailyRecord);

    await harness.preview();

    const state = harness.visibleState();
    expect(state.error).toBe(
      'El censo previo quedó por verificar porque la fecha recibida no corresponde. Vuelve a sincronizar.'
    );
    expect(visibleErrorTechnicalDetail(state, true)).toBeNull();
    expect(logged).not.toHaveBeenCalled();
    expect(harness.stages()).toEqual(['planning_structure', 'failed']);
  });

  it('tells the person to retry with a connection when the previous census cannot be read', async () => {
    evidence.lookupEgresos.mockReset();
    evidence.lookupEgresos.mockResolvedValue([]);
    const logged = vi.spyOn(errorService, 'logError').mockImplementation(() => undefined);
    const dailyRecord = readableDays();
    dailyRecord.getAuthoritativeForDate.mockRejectedValue(
      Object.assign(new Error('Failed to get document because the client is offline.'), {
        code: 'unavailable',
      })
    );
    const harness = renderPreview(dailyRecord);

    await harness.preview();

    expect(harness.stages()).toEqual(['planning_structure', 'failed']);
    expect(harness.failRun).toHaveBeenCalledWith('apply_failed', 'run-1');
    expect(harness.visibleState().error).toBe(
      'La conexión se cortó antes de terminar. Vuelve a sincronizar cuando haya conexión.'
    );
    expect(logged).not.toHaveBeenCalled();
    expect(harness.applyDiff).not.toHaveBeenCalled();
  });

  it('does nothing when the read fails after the session changed', async () => {
    evidence.lookupEgresos.mockReset();
    evidence.lookupEgresos.mockResolvedValue([]);
    const logged = vi.spyOn(errorService, 'logError').mockImplementation(() => undefined);
    setSessionGeneration('generation-a', 'owner-a');
    let rejectRead: (error: Error) => void = () => undefined;
    let readStarted: () => void = () => undefined;
    const started = new Promise<void>(resolve => {
      readStarted = resolve;
    });
    const dailyRecord = readableDays();
    dailyRecord.getAuthoritativeForDate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRead = reject;
          readStarted();
        })
    );
    const harness = renderPreview(dailyRecord);

    const work = harness.preview();
    await started;
    setSessionGeneration('generation-b', 'owner-b');
    rejectRead(new Error('late read of the previous session'));
    await work;

    expect(harness.failRun).not.toHaveBeenCalled();
    expect(harness.visibleState()).toEqual(initialState);
    expect(harness.stages()).toEqual(['planning_structure']);
    expect(harness.preparedSyncContextRef.current).not.toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });
});
