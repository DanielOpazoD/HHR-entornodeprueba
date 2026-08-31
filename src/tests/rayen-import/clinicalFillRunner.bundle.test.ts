import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { RayenPatientClinicalBundle } from '@/features/rayen-import/contracts/patientClinicalBundle';
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

  it('sin capability (bundle null) usa el camino legado de tres canales', async () => {
    const dependencies = deps({
      fetchPatientClinicalBundle: vi.fn().mockResolvedValue(null),
    });

    await runClinicalFill(record(), '2026-07-10', dependencies);

    expect(dependencies.fetchDeviceReport).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchScalesForms).toHaveBeenCalledTimes(1);
  });
});
