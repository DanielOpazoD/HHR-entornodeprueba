import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';

vi.mock('@/features/rayen-import/domain/clinicalCarryoverVerification', () => {
  throw new Error('Synthetic verification module unavailable');
});

const DAY = '2026-10-19';
const sources = () =>
  ({
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '', source: 'json', entries: [] }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
    fetchCudyrCategories: vi
      .fn()
      .mockResolvedValue({ items: [], source: 'gestion_camas', historyAvailable: true }),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    archiveCudyrCapture: vi.fn().mockResolvedValue(undefined),
    now: () => new Date(`${DAY}T18:00:00Z`),
    createId: () => 'synthetic-id',
  }) satisfies ClinicalFillDeps;

const census = () => ({
  ...buildInitializedDayRecord(DAY, null),
  beds: {
    R1: {
      ...createEmptyPatient('R1'),
      patientName: 'PACIENTE SINTETICO',
      clinicalEpisodeId: 'synthetic-episode',
    },
  },
});

describe('deferred carryover verification', () => {
  it('fails before source reads or writes when verification cannot load', async () => {
    const record = census();
    const original = structuredClone(record);
    const carried = {
      ...record,
      beds: {
        R1: {
          ...record.beds.R1,
          clinicalCarryover: {
            sourceDate: '2026-10-18',
            clinicalEpisodeId: 'synthetic-episode',
            vitalsPending: true,
            devicesPending: true,
          },
        },
      },
    };
    const deps = sources();
    await expect(runClinicalFill(carried, DAY, deps)).rejects.toThrow();
    for (const operation of [
      deps.fetchDeviceReport,
      deps.extractDeviceItems,
      deps.fetchHistoryScales,
      deps.fetchScalesForms,
      deps.fetchCudyrCategories,
      deps.applyPatch,
      deps.archiveCudyrCapture,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(record).toEqual(original);
    expect(carried.beds.R1.clinicalCarryover.vitalsPending).toBe(true);
    expect(carried.beds.R1.clinicalCarryover.devicesPending).toBe(true);
  });

  it('keeps ordinary synchronization available without the optional verification module', async () => {
    const deps = sources();
    const result = await runClinicalFill(census(), DAY, deps);
    expect(result).toMatchObject({ total: 1, errors: [] });
    expect(deps.fetchDeviceReport).toHaveBeenCalledTimes(1);
    expect(deps.fetchHistoryScales).toHaveBeenCalledTimes(1);
  });
});
