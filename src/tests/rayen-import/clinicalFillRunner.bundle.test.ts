import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { RayenPatientClinicalBundle } from '@/features/rayen-import/contracts/patientClinicalBundle';
import { mapHistoryScalesPayload } from '@/features/rayen-import/bridge/patientClinicalBundleChannel';
import { readClinicalPatientSources } from '@/features/rayen-import/domain/clinicalPatientReaders';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const SCALE_EVENT = {
  publishDatetime: '2026-07-10T10:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
  ],
};

const record = (): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: {
      R1: { bedId: 'R1', patientName: 'Paciente 1', clinicalEpisodeId: 'E1', devices: [] },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const bundle = (
  overrides: Partial<RayenPatientClinicalBundle> = {}
): RayenPatientClinicalBundle => ({
  devices: { entries: [], base64: '' },
  history: { events: [SCALE_EVENT], nursingActivity: [] },
  forms: { forms: [] },
  ...overrides,
});

const deps = (overrides: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [SCALE_EVENT], nursingActivity: [] }),
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

describe('runClinicalFill · paquete clínico por paciente', () => {
  afterEach(() => vi.restoreAllMocks());

  it('con el bundle completo no toca los canales individuales (1 request por paciente)', async () => {
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockResolvedValue(bundle()),
    });

    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);

    expect(dependencies.fetchPatientClinicalBundle).toHaveBeenCalledWith('E1', '2026-07-10', {
      censusDate: '2026-07-10',
      lookbackDays: expect.anything(),
    });
    expect(dependencies.fetchDeviceReport).not.toHaveBeenCalled();
    expect(dependencies.fetchHistoryScales).not.toHaveBeenCalled();
    expect(dependencies.fetchScalesForms).not.toHaveBeenCalled();
    // 1 bundle + 1 preflight CUDYR (antes: 3 lecturas + CUDYR = 4).
    expect(summary.performance?.counters.requests).toBe(2);
    expect(summary.errors).toEqual([]);
  });

  it('una sección fallida del bundle se reintenta UNA vez por su canal individual', async () => {
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockResolvedValue(
        bundle({
          history: { events: [], nursingActivity: [], error: 'timeout historia' },
        })
      ),
    });

    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);

    expect(dependencies.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchDeviceReport).not.toHaveBeenCalled();
    expect(dependencies.fetchScalesForms).not.toHaveBeenCalled();
    expect(summary.performance?.counters.retries).toBe(1);
    expect(summary.errors.filter(e => e.source === 'scales')).toEqual([]);
  });

  it.each([true, false])('keeps malformed history retryable, recovery=%s', async recovered => {
    const malformed = mapHistoryScalesPayload({});
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockResolvedValue(bundle({ history: malformed })),
      fetchHistoryScales: vi
        .fn()
        .mockResolvedValue(recovered ? { events: [SCALE_EVENT], nursingActivity: [] } : malformed),
    });
    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);
    expect(dependencies.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchDeviceReport).not.toHaveBeenCalled();
    expect(dependencies.fetchScalesForms).not.toHaveBeenCalled();
    expect(summary.errors.filter(error => error.source === 'scales')).toHaveLength(
      recovered ? 0 : 1
    );
  });

  it.each([
    new Error('Message port closed'),
    { error: 'HTTP 403 from stale proxy', errorCode: 'source_unavailable' },
    Object.assign(new Error('HTTP 403 from stale proxy'), { errorCode: 'source_timeout' }),
  ])('recovers an interrupted bundle preserving its stable failure code: %j', async failure => {
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockRejectedValue(failure),
    });
    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);
    expect(dependencies.fetchDeviceReport).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchScalesForms).toHaveBeenCalledTimes(1);
    expect(summary.performance?.counters.retries).toBe(3);
    expect(summary.errors).toEqual([]);
  });

  it('keeps a denied section visible without repeating it or discarding successful siblings', async () => {
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockResolvedValue(
        bundle({
          forms: { forms: [], error: 'Forbidden', errorCode: 'permission_denied' },
        })
      ),
    });
    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);
    expect(dependencies.fetchScalesForms).not.toHaveBeenCalled();
    expect(dependencies.fetchHistoryScales).not.toHaveBeenCalled();
    expect(dependencies.fetchDeviceReport).not.toHaveBeenCalled();
    expect(summary.errors.some(error => error.source === 'vitals')).toBe(true);
    expect(summary.performance?.counters.retries).toBe(0);
  });

  it('keeps persistent source failures explicit and preserves existing patient data', async () => {
    const original = record();
    original.beds.R1.pathology = 'Diagnóstico local conservado';
    const before = structuredClone(original);
    const unavailable = () => Promise.reject(new Error('Source unavailable'));
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn(unavailable),
      fetchDeviceReport: vi.fn(unavailable),
      fetchHistoryScales: vi.fn(unavailable),
      fetchScalesForms: vi.fn(unavailable),
    });
    const summary = await runClinicalFill(original, '2026-07-10', dependencies);
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(dependencies.fetchDeviceReport).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchScalesForms).toHaveBeenCalledTimes(1);
    expect(original).toEqual(before);
    expect(dependencies.fetchHistoryScales).toHaveBeenCalledWith('E1', '2026-07-10', {
      lookbackDays: expect.anything(),
    });
  });

  it('does not read individual sources after cancellation of the aggregate', async () => {
    const controller = new AbortController();
    const dependencies = deps({
      signal: controller.signal,
      fetchPatientClinicalBundle: vi.fn(async () => {
        controller.abort(new DOMException('Cancelled', 'AbortError'));
        throw controller.signal.reason;
      }),
    });
    await expect(runClinicalFill(record(), '2026-07-10', dependencies)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(dependencies.fetchDeviceReport).not.toHaveBeenCalled();
    expect(dependencies.fetchHistoryScales).not.toHaveBeenCalled();
    expect(dependencies.fetchScalesForms).not.toHaveBeenCalled();
    expect(dependencies.applyPatch).not.toHaveBeenCalled();
  });

  it('sin capability (bundle null) usa el camino legado de tres canales', async () => {
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockResolvedValue(null),
    });

    await runClinicalFill(record(), '2026-07-10', dependencies);

    expect(dependencies.fetchDeviceReport).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchScalesForms).toHaveBeenCalledTimes(1);
  });

  it('rejects a recovery response that arrives after cancellation', async () => {
    const controller = new AbortController();
    const run = <T>(operation: () => Promise<T>) => operation();
    const dependencies = deps({
      signal: controller.signal,
      fetchPatientClinicalBundle: vi.fn().mockRejectedValue(new Error('Message port closed')),
      fetchDeviceReport: vi.fn(() => new Promise<never>(() => {})),
      fetchHistoryScales: vi.fn(async () => {
        await Promise.resolve();
        controller.abort();
        return { events: [SCALE_EVENT], nursingActivity: [] };
      }),
    });
    await expect(
      readClinicalPatientSources({
        encId: 'E1',
        fecha: '2026-07-10',
        lookbackDays: 1,
        deps: dependencies,
        slots: { bundle: run, devices: run, history: run, forms: run },
        performance: { trackRequest: run, recordTimeout: vi.fn(), recordRetries: vi.fn() },
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([true, false])(
    'reintenta una vez si falla el parser PDF; recuperación=%s',
    async recovered => {
      const dependencies = deps({
        fetchPatientClinicalBundle: vi
          .fn()
          .mockResolvedValue(bundle({ devices: { base64: 'invalid-pdf', source: 'pdf' } })),
        extractDeviceItems: vi.fn().mockRejectedValue(new Error('Invalid PDF structure')),
        fetchDeviceReport: recovered
          ? vi.fn().mockResolvedValue({ base64: '', source: 'json', entries: [] })
          : vi.fn().mockRejectedValue(new Error('Device source unavailable')),
      });
      const summary = await runClinicalFill(record(), '2026-07-10', dependencies);
      expect(dependencies.fetchDeviceReport).toHaveBeenCalledTimes(1);
      expect(dependencies.fetchHistoryScales).not.toHaveBeenCalled();
      expect(dependencies.fetchScalesForms).not.toHaveBeenCalled();
      expect(summary.performance?.counters.retries).toBe(1);
      expect(summary.errors.filter(error => error.source === 'devices')).toHaveLength(
        recovered ? 0 : 1
      );
    }
  );
});
