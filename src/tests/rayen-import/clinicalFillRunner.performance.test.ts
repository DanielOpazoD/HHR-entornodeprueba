import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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
  fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date('2026-07-10T12:00:00.000Z'),
  createId: () => 'device-id',
  ...overrides,
});

describe('runClinicalFill performance pipeline', () => {
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
    const dependencies = deps({ applyBatch });

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
        counters: { patches: 1, retries: 1 },
      },
    });
  });

  it('reports only the patients that fail on the established fallback path', async () => {
    const applyBatch = vi.fn().mockResolvedValue({
      patientWrites: 4,
      historySnapshots: 1,
      failures: [{ index: 1, message: 'conflicto paciente 2' }],
    });

    const summary = await runClinicalFill(record(5), '2026-07-10', deps({ applyBatch }));

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

    const summary = await runClinicalFill(record(2), '2026-07-10', deps({ applyBatch }));

    expect(summary).toMatchObject({
      total: 2,
      patched: 0,
      performance: { counters: { retries: 1 } },
    });
    expect(summary.errors).toHaveLength(2);
  });

  it('keeps shadow persistence per patient and observes the collected batch afterwards', async () => {
    const observeBatch = vi.fn().mockResolvedValue(undefined);
    const dependencies = deps({ observeBatch });

    const summary = await runClinicalFill(record(5), '2026-07-10', dependencies);

    expect(dependencies.applyPatch).toHaveBeenCalledTimes(5);
    expect(observeBatch).toHaveBeenCalledTimes(1);
    expect(observeBatch.mock.calls[0]?.[0]).toHaveLength(5);
    expect(summary).toMatchObject({ total: 5, patched: 5, errors: [] });
  });

  it('does not keep clinical fill waiting for a slow shadow observer', async () => {
    const observeBatch = vi.fn(() => new Promise<void>(() => undefined));

    await expect(
      runClinicalFill(record(1), '2026-07-10', deps({ observeBatch }))
    ).resolves.toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(observeBatch).toHaveBeenCalledTimes(1);
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
