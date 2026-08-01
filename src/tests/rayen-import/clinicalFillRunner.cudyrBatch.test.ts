import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {
      H1C2: { bedId: 'H1C2', patientName: 'Paciente uno', clinicalEpisodeId: 'E1', devices: [] },
      H2C1: { bedId: 'H2C1', patientName: 'Paciente dos', clinicalEpisodeId: 'E2', devices: [] },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

describe('runClinicalFill historical CUDYR batch', () => {
  it('consolidates several patients into one persistence operation', async () => {
    const applyHistoricalCudyr = vi.fn();
    const applyHistoricalCudyrBatch = vi.fn().mockImplementation(async (_day, items) =>
      items.map((item: { clinicalEpisodeId: string }) => ({
        clinicalEpisodeId: item.clinicalEpisodeId,
        persisted: true,
        changed: true,
      }))
    );
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          { encId: 'E1', crdValue: 'C2', crdDateTime: '2026-07-16T07:00:00+00:00' },
          { encId: 'E2', crdValue: 'B1', crdDateTime: '2026-07-16T07:30:00+00:00' },
        ],
      }),
      applyHistoricalCudyr,
      applyHistoricalCudyrBatch,
      applyPatch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date(Date.UTC(2026, 6, 16, 12, 0, 0)),
      createId: () => 'id-1',
    };

    const summary = await runClinicalFill(record(), '2026-07-16', deps);

    expect(summary).toMatchObject({ total: 2, patched: 2, errors: [] });
    expect(applyHistoricalCudyr).not.toHaveBeenCalled();
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledTimes(1);
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledWith('2026-07-15', [
      expect.objectContaining({
        clinicalEpisodeId: 'E1',
        cudyr: expect.objectContaining({ category: 'C2' }),
      }),
      expect.objectContaining({
        clinicalEpisodeId: 'E2',
        cudyr: expect.objectContaining({ category: 'B1' }),
      }),
    ]);
    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
  });

  it('contains an eager batch rejection until each patient can report it normally', async () => {
    const applyHistoricalCudyrBatch = vi.fn().mockRejectedValue(new Error('write unavailable'));
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve({ base64: '' }), 0);
          })
      ),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          { encId: 'E1', crdValue: 'C2', crdDateTime: '2026-07-16T07:00:00+00:00' },
          { encId: 'E2', crdValue: 'B1', crdDateTime: '2026-07-16T07:30:00+00:00' },
        ],
      }),
      applyHistoricalCudyrBatch,
      applyPatch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date(Date.UTC(2026, 6, 16, 12, 0, 0)),
      createId: () => 'id-1',
    };

    const summary = await runClinicalFill(record(), '2026-07-16', deps);

    expect(summary.errors).toEqual([
      expect.objectContaining({
        bedId: 'H1C2',
        source: 'cudyr',
        message: expect.stringContaining('write unavailable'),
      }),
      expect.objectContaining({
        bedId: 'H2C1',
        source: 'cudyr',
        message: expect.stringContaining('write unavailable'),
      }),
    ]);
  });
});
