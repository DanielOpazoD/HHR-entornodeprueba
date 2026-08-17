import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runClinicalFill,
  type ClinicalFillBatchApplyResult,
  type ClinicalFillDeps,
  type ClinicalFillPatchOperation,
  type ClinicalFillPersistenceStrategy,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { logger } from '@/services/utils/loggerService';

const SCALE_EVENT = {
  publishDatetime: '2026-07-10T10:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
  ],
};

const record = (patientCount: number): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: Object.fromEntries(
      Array.from({ length: patientCount }, (_, index) => {
        const position = index + 1;
        return [
          `R${position}`,
          {
            bedId: `R${position}`,
            patientName: `Paciente ${position}`,
            clinicalEpisodeId: `E${position}`,
            devices: [],
          },
        ];
      })
    ),
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const deps = (overrides: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [SCALE_EVENT] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue({
    items: [],
    source: 'gestion_camas',
    historyAvailable: true,
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date('2026-07-10T12:00:00.000Z'),
  createId: () => 'device-id',
  ...overrides,
});

const deferredPersistence = (
  persist: (operations: ClinicalFillPatchOperation[]) => Promise<ClinicalFillBatchApplyResult>
): ClinicalFillPersistenceStrategy => ({ disposition: 'deferred', persist });

const observedPersistence = (
  persist: Extract<ClinicalFillPersistenceStrategy, { disposition: 'observe' }>['persist']
): ClinicalFillPersistenceStrategy => ({ disposition: 'observe', persist });

describe('runClinicalFill performance pipeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    logger.clearEntries();
  });

  it('starts devices, history and forms together so slow source waits are not additive', async () => {
    let releaseDevice: ((value: { base64: string }) => void) | undefined;
    const fetchDeviceReport = vi.fn(
      () =>
        new Promise<{ base64: string }>(resolve => {
          releaseDevice = resolve;
        })
    );
    const fetchHistoryScales = vi.fn().mockResolvedValue({ events: [] });
    const fetchScalesForms = vi.fn().mockResolvedValue({ forms: [] });
    const dependencies = deps({ fetchDeviceReport, fetchHistoryScales, fetchScalesForms });

    const pending = runClinicalFill(record(1), '2026-07-10', dependencies);

    await vi.waitFor(() => {
      expect(fetchDeviceReport).toHaveBeenCalledTimes(1);
      expect(fetchHistoryScales).toHaveBeenCalledTimes(1);
      expect(fetchHistoryScales).toHaveBeenCalledWith('E1', '2026-07-10', {
        lookbackDays: 14,
      });
      expect(fetchScalesForms).toHaveBeenCalledTimes(1);
    });
    releaseDevice?.({ base64: '' });

    await expect(pending).resolves.toMatchObject({ total: 1, errors: [] });
  });

  it('reports aggregate stage and request metrics without patient identifiers', async () => {
    let clock = 0;
    const summary = await runClinicalFill(
      record(1),
      '2026-07-10',
      deps({ monotonicNow: () => (clock += 10) })
    );

    expect(summary.performance).toMatchObject({
      stagesMs: {
        clinicalReads: expect.any(Number),
        writeQueueWait: expect.any(Number),
        persistence: expect.any(Number),
      },
      counters: {
        requests: 4,
        cacheHits: 0,
        patches: 1,
        retries: 0,
        timeouts: 0,
      },
    });
    expect(summary.performance?.stagesMs.clinicalReads).toBeGreaterThan(0);
    expect(summary.performance?.stagesMs.writeQueueWait).toBeGreaterThan(0);
    expect(summary.performance?.stagesMs.persistence).toBeGreaterThan(0);
    expect(JSON.stringify(summary.performance)).not.toMatch(/Paciente 1|E1|R1|rut|encounter/i);
  });

  it('counts source timeouts as sanitized aggregates', async () => {
    const summary = await runClinicalFill(
      record(1),
      '2026-07-10',
      deps({
        fetchDeviceReport: vi
          .fn()
          .mockResolvedValue({ base64: '', error: 'Tiempo de espera agotado leyendo PDF.' }),
      })
    );

    expect(summary.performance?.counters.timeouts).toBe(1);
    expect(summary.performance).not.toHaveProperty('errors');
  });

  it('counts one timed-out request once even when it affects multiple clinical sources', async () => {
    const summary = await runClinicalFill(
      record(1),
      '2026-07-10',
      deps({
        fetchScalesForms: vi
          .fn()
          .mockResolvedValue({ forms: [], error: 'Tiempo de espera agotado leyendo formularios.' }),
      })
    );

    expect(summary.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'scales' }),
        expect.objectContaining({ source: 'vitals' }),
      ])
    );
    expect(summary.performance?.counters.timeouts).toBe(1);
  });

  it('records zero-valued clinical stages when no patient needs enrichment', async () => {
    const summary = await runClinicalFill(record(0), '2026-07-10', deps());

    expect(summary.performance).toEqual({
      stagesMs: { clinicalReads: 0, writeQueueWait: 0, persistence: 0 },
      counters: { requests: 0, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
    });
  });

  it('starts the next patient read as soon as a slot is free without waiting for a slow write', async () => {
    let releaseWrite: (() => void) | undefined;
    const writeBarrier = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const fetchScalesForms = vi.fn().mockResolvedValue({ forms: [] });
    const applyPatch = vi.fn(() => writeBarrier);
    const dependencies = deps({ fetchScalesForms, applyPatch });

    const pending = runClinicalFill(record(5), '2026-07-10', dependencies);

    await vi.waitFor(() => {
      expect(applyPatch).toHaveBeenCalledTimes(1);
      expect(fetchScalesForms).toHaveBeenCalledTimes(5);
    });
    releaseWrite?.();

    await expect(pending).resolves.toMatchObject({ total: 5, patched: 5, errors: [] });
    expect(applyPatch).toHaveBeenCalledTimes(5);
  });

  it('persists all prepared patients through one optional transactional batch', async () => {
    const applyBatch = vi.fn().mockResolvedValue({
      patientWrites: 1,
      historySnapshots: 1,
      retries: 1,
    });
    const dependencies = deps({ persistenceStrategy: deferredPersistence(applyBatch) });

    const summary = await runClinicalFill(record(5), '2026-07-10', dependencies);

    expect(applyBatch).toHaveBeenCalledTimes(1);
    expect(applyBatch.mock.calls[0]?.[0]).toHaveLength(5);
    expect(dependencies.applyPatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      total: 5,
      patched: 5,
      errors: [],
      incremental: {
        patientWrites: 1,
        historySnapshots: 1,
      },
      performance: {
        counters: { cacheHits: 4, patches: 1, retries: 1 },
      },
    });
  });

  it('reports only the patients that fail on the established fallback path', async () => {
    const applyBatch = vi.fn().mockResolvedValue({
      patientWrites: 4,
      historySnapshots: 1,
      failures: [{ index: 1, message: 'conflicto paciente 2' }],
    });

    const summary = await runClinicalFill(
      record(5),
      '2026-07-10',
      deps({ persistenceStrategy: deferredPersistence(applyBatch) })
    );

    expect(summary).toMatchObject({
      total: 5,
      patched: 4,
      errors: [{ bedId: 'R2', source: 'patch', message: 'conflicto paciente 2' }],
      incremental: { patientWrites: 4, historySnapshots: 1 },
    });
  });

  it('counts a failed transactional retry in aggregate performance', async () => {
    const failure = Object.assign(new Error('backend no disponible'), {
      clinicalBatchRetries: 1,
    });
    const applyBatch = vi.fn().mockRejectedValue(failure);

    const summary = await runClinicalFill(
      record(2),
      '2026-07-10',
      deps({ persistenceStrategy: deferredPersistence(applyBatch) })
    );

    expect(summary).toMatchObject({
      total: 2,
      patched: 0,
      performance: { counters: { retries: 1 } },
    });
    expect(summary.errors).toHaveLength(2);
  });

  it('keeps shadow persistence per patient and observes the collected batch afterwards', async () => {
    const observeBatch = vi.fn().mockResolvedValue({
      mode: 'shadow',
      parity: 'matched',
      clinicalTargets: 5,
      checkpointTargets: 5,
      checkpointOnlyTargets: 0,
      requestedFields: 10,
      backendTargets: 5,
      backendFields: 10,
    });
    const dependencies = deps({ persistenceStrategy: observedPersistence(observeBatch) });

    const summary = await runClinicalFill(record(5), '2026-07-10', dependencies);

    expect(dependencies.applyPatch).toHaveBeenCalledTimes(5);
    expect(observeBatch).toHaveBeenCalledTimes(1);
    expect(observeBatch.mock.calls[0]?.[0]).toHaveLength(5);
    expect(summary).toMatchObject({
      total: 5,
      patched: 5,
      errors: [],
      incremental: { batch: { parity: 'matched', clinicalTargets: 5 } },
    });
  });

  it('reports a bounded correlated diagnostic when the shadow observer throws', async () => {
    const observeBatch = vi.fn().mockRejectedValue(new Error('sensitive provider detail'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.clearEntries();

    const summary = await runClinicalFill(
      record(1),
      '2026-07-10',
      deps({
        persistenceStrategy: observedPersistence(observeBatch),
        diagnosticRunId: 'sync-run',
      })
    );

    expect(summary).toMatchObject({
      total: 1,
      patched: 1,
      errors: [],
      incremental: { batch: { mode: 'shadow', parity: 'unavailable' } },
    });
    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'clinical_batch_shadow_observation_failed',
        context: 'RayenSync',
        data: {
          runId: 'sync-run',
          errorKind: 'unexpected',
          patientCount: 1,
          batchMode: 'shadow',
        },
      })
    );
    expect(JSON.stringify(logger.getEntries())).not.toContain('sensitive provider detail');
  });

  it('persists legacy patches before waiting for the bounded shadow parity result', async () => {
    let releaseObservation: (() => void) | undefined;
    const observeBatch = vi.fn(
      () =>
        new Promise<{
          mode: 'shadow';
          parity: 'matched';
          clinicalTargets: number;
          checkpointTargets: number;
          checkpointOnlyTargets: number;
          requestedFields: number;
        }>(resolve => {
          releaseObservation = () =>
            resolve({
              mode: 'shadow',
              parity: 'matched',
              clinicalTargets: 1,
              checkpointTargets: 1,
              checkpointOnlyTargets: 0,
              requestedFields: 2,
            });
        })
    );

    const dependencies = deps({ persistenceStrategy: observedPersistence(observeBatch) });
    const pending = runClinicalFill(record(1), '2026-07-10', dependencies);
    await vi.waitFor(() => expect(dependencies.applyPatch).toHaveBeenCalledTimes(1));
    expect(observeBatch).toHaveBeenCalledTimes(1);
    releaseObservation?.();
    await expect(pending).resolves.toMatchObject({ total: 1, patched: 1, errors: [] });
  });

  it('bounds each source independently so slow PDFs do not block history or forms', async () => {
    const releaseReads: Array<() => void> = [];
    const fetchDeviceReport = vi.fn(
      () =>
        new Promise<{ base64: string }>(resolve => {
          releaseReads.push(() => resolve({ base64: '' }));
        })
    );
    const fetchHistoryScales = vi.fn().mockResolvedValue({ events: [] });
    const fetchScalesForms = vi.fn().mockResolvedValue({ forms: [] });
    const dependencies = deps({ fetchDeviceReport, fetchHistoryScales, fetchScalesForms });

    const pending = runClinicalFill(record(5), '2026-07-10', dependencies);

    await vi.waitFor(() => expect(fetchDeviceReport).toHaveBeenCalledTimes(4));
    expect(releaseReads).toHaveLength(4);
    await vi.waitFor(() => {
      expect(fetchHistoryScales).toHaveBeenCalledTimes(5);
      expect(fetchScalesForms).toHaveBeenCalledTimes(5);
    });
    releaseReads[0]();
    await vi.waitFor(() => expect(fetchDeviceReport).toHaveBeenCalledTimes(5));
    releaseReads.slice(1).forEach(release => release());

    await expect(pending).resolves.toMatchObject({ total: 5, errors: [] });
    // CUDYR is one shared bulk promise for the whole census, never a request per patient.
    expect(dependencies.fetchCudyrCategories).toHaveBeenCalledTimes(1);
  });
});
