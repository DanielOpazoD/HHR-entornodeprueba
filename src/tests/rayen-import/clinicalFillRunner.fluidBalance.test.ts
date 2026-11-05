import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import type { RayenFluidBalanceResult } from '@/features/rayen-import/contracts/patientClinicalBundle';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildClinicalPatientPatch } from '@/features/rayen-import/domain/clinicalPatientPatch';
import { mapFluidBalancePayload } from '@/features/rayen-import/bridge/patientClinicalBundleChannel';
const DAY = '2026-11-04';
const STORED = {
  censusDate: DAY,
  day: { intakeMl: 900, urineOutputMl: 300, records: 2 },
  night: { intakeMl: 0, urineOutputMl: 0, records: 0 },
};
const patient = () =>
  DataFactory.createMockPatient('R1', { clinicalEpisodeId: '123456', fluidBalance: STORED });
const record = (): DailyRecord =>
  ({
    date: DAY,
    beds: { R1: patient() },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;
const deps = (fluidBalance?: RayenFluidBalanceResult): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ entries: [], source: 'json', base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi
    .fn()
    .mockResolvedValue({ items: [], source: 'gestion_camas', historyAvailable: true }),
  fetchPatientClinicalBundle: vi.fn().mockResolvedValue({
    devices: { entries: [], base64: '' },
    history: { events: [], nursingActivity: [] },
    forms: { forms: [] },
    fluidBalance,
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date('2026-11-04T21:00:00Z'),
  createId: () => 'synthetic',
});
const patches = (d: ClinicalFillDeps) =>
  vi
    .mocked(d.applyPatch)
    .mock.calls.map(([patch]) => patch['beds.R1.fluidBalance'])
    .filter(Boolean);

describe('balance through the clinical synchronization owner', () => {
  it('replaces, never accumulates, a successful day snapshot and persists a confirmed empty snapshot', async () => {
    const d = deps({
      censusDate: DAY,
      entries: [
        {
          id: 1,
          hydBalType: 'IN',
          hydBalName: 'Oral',
          inputQuantity: 100,
          regDatetime: '2026-11-04T09:00:00-05:00',
        },
      ],
    });
    await runClinicalFill(record(), DAY, d);
    expect(patches(d)).toEqual([
      { ...STORED, day: { intakeMl: 100, urineOutputMl: 0, records: 1 } },
    ]);
    const empty = deps({ censusDate: DAY, entries: [] });
    await runClinicalFill(record(), DAY, empty);
    expect(patches(empty)).toEqual([{ censusDate: DAY, day: STORED.night, night: STORED.night }]);
  });
  it.each<RayenFluidBalanceResult | undefined>([
    undefined,
    { censusDate: DAY, entries: [], error: 'HTTP 500', errorCode: 'source_unavailable' },
    { censusDate: '2026-11-03', entries: [] },
    {
      censusDate: DAY,
      entries: [
        { id: 1, hydBalType: 'IN', inputQuantity: 100, regDatetime: '2026-11-04T09:00:00' },
      ],
    },
  ])('preserves stored totals on unsupported, failed or unverifiable reads: %j', async value => {
    const d = deps(value);
    const result = await runClinicalFill(record(), DAY, d);
    expect(patches(d)).toEqual([]);
    expect(result.errors.some(error => error.source === 'fluid_balance')).toBe(value !== undefined);
  });
  it('targets the newborn independently and does not include unchanged balances', () => {
    const p = patient();
    expect(buildClinicalPatientPatch(p, p, 'R1', true).patch).toEqual({});
    const changed = {
      ...p,
      fluidBalance: { ...STORED, night: { intakeMl: 100, urineOutputMl: 0, records: 1 } },
    };
    expect(buildClinicalPatientPatch(p, changed, 'R1', true).patch).toEqual({
      'beds.R1.clinicalCrib.fluidBalance': changed.fluidBalance,
    });
  });
  it('marks malformed bridge payloads as failures rather than successful zero totals', () => {
    expect(mapFluidBalancePayload({ censusDate: DAY, entries: null }).error).toBeTruthy();
    expect(mapFluidBalancePayload({ entries: [] }).error).toBeTruthy();
  });
});
