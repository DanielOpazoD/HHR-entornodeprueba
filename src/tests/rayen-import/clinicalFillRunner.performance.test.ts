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
