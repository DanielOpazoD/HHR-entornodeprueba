// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import type { RayenFluidBalanceResult } from '@/features/rayen-import/contracts/patientClinicalBundle';
import { buildClinicalPatientPatch } from '@/features/rayen-import/domain/clinicalPatientPatch';
import { mapFluidBalancePayload } from '@/features/rayen-import/bridge/patientClinicalBundleChannel';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { asStoredDailyRecordShape, DataFactory } from '@/tests/factories/DataFactory';

describe('balance through the clinical synchronization owner', () => {
  const DAY = '2026-11-04';
  const STORED = {
    censusDate: DAY,
    day: { intakeMl: 900, urineOutputMl: 300, records: 2 },
    night: { intakeMl: 0, urineOutputMl: 0, records: 0 },
  };
  const patient = () =>
    DataFactory.createMockPatient('R1', { clinicalEpisodeId: '123456', fluidBalance: STORED });
  const record = (): DailyRecord =>
    DataFactory.createMockDailyRecord(DAY, {
      beds: { R1: patient() },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
    });
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

// Ficha Médico writes these evolution stamps in mainland time: 12:15 there is 10:15 in Rapa Nui.
describe('runClinicalFill staffing inference', () => {
  const staffingRecord = (beds: Record<string, { encId?: string }>): DailyRecord =>
    asStoredDailyRecordShape({
      date: '2026-07-10',
      beds: Object.fromEntries(
        Object.entries(beds).map(([bedId, { encId }]) => [
          bedId,
          { bedId, patientName: 'Paciente X', clinicalEpisodeId: encId, devices: [] },
        ])
      ),
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
    });

  const staffingDeps = (over: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
    }),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    now: () => new globalThis.Date(Date.UTC(2026, 6, 10, 12, 0, 0)),
    createId: () => 'id-1',
    ...over,
  });

  it('registers discovered staff even when no shift can be inferred and reports a storage failure', async () => {
    const activity = {
      author: 'Ana Soto Rojas',
      role: 'Enfermera(o)',
      recordedAt: '2026-07-10T12:15:00',
      source: 'evolution',
    };
    const registerStaff = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const summary = await runClinicalFill(
      staffingRecord({ H1C2: { encId: 'E1' } }),
      '2026-07-10',
      staffingDeps({
        registerStaff,
        fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [activity] }),
      })
    );
    expect(registerStaff).toHaveBeenCalledWith([{ ...activity, encounterId: 'E1' }]);
    expect(summary.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'staffing', bedId: '*' })])
    );
  });

  it('aggregates text-free nursing activity across patients into a reviewable proposal', async () => {
    const fetchHistoryScales = vi.fn().mockImplementation(async (encId: string) => ({
      events: [],
      nursingActivity: [
        {
          author: 'Ana Enfermera',
          role: 'Enfermera(o)',
          recordedAt: encId === 'E1' ? '2026-07-10T12:15:00' : '2026-07-10T16:15:00',
          source: 'evolution',
        },
        {
          author: 'Jimena Yáñez',
          role: 'Paramédico',
          recordedAt: encId === 'E1' ? '2026-07-10T13:15:00' : '2026-07-10T17:15:00',
          source: 'evolution',
        },
      ],
    }));

    const summary = await runClinicalFill(
      staffingRecord({ H1C2: { encId: 'E1' }, H2C1: { encId: 'E2' } }),
      '2026-07-10',
      staffingDeps({ fetchHistoryScales })
    );

    expect(summary.staffingProposal?.day.names).toEqual(['Ana Enfermera']);
    expect(summary.staffingProposal?.night.names).toEqual([]);
    expect(summary.staffingProposal?.tensDay?.names).toEqual(['Jimena Yáñez']);
    expect(summary.staffingProposal?.day.candidates[0]).toMatchObject({
      records: 2,
      patients: 2,
      activeHours: 2,
    });
  });

  it('uses the HHR nurse catalog to accept and shorten one valid Eloísa observation', async () => {
    const summary = await runClinicalFill(
      staffingRecord({ H1C2: { encId: 'E1' } }),
      '2026-07-10',
      staffingDeps({
        nurseCatalog: ['Camila Soto'],
        fetchHistoryScales: vi.fn().mockResolvedValue({
          events: [],
          nursingActivity: [
            {
              author: 'Camila Soto Alegria',
              authorIdentity: { firstGivenName: 'Camila', firstSurname: 'Soto' },
              role: 'Enfermera(o)',
              recordedAt: '2026-07-10T12:20:00',
              source: 'evolution',
            },
          ],
        }),
      })
    );

    expect(summary.staffingProposal?.day.names).toEqual(['Camila Soto']);
  });

  it('uses the HHR TENS catalog to accept one authoritative Paramédico activity', async () => {
    const summary = await runClinicalFill(
      staffingRecord({ H1C2: { encId: 'E1' } }),
      '2026-07-10',
      staffingDeps({
        tensCatalog: ['Jimena Yáñez'],
        fetchHistoryScales: vi.fn().mockResolvedValue({
          events: [],
          nursingActivity: [
            {
              author: 'Jimena Yañez',
              role: 'Paramédico',
              recordedAt: '2026-07-10T17:20:00',
              source: 'vital-signs',
            },
          ],
        }),
      })
    );

    expect(summary.staffingProposal?.tensDay?.names).toEqual(['Jimena Yáñez']);
    expect(summary.staffingProposal?.tensDay?.candidates[0]).toMatchObject({
      records: 1,
      catalogMatched: true,
    });
  });

  it('preserves an ambiguity-only staffing result for human review', async () => {
    const fetchHistoryScales = vi.fn().mockImplementation(async (encId: string) => ({
      events: [],
      nursingActivity: ['Ana Pérez', 'Berta Soto', 'Carla Rojas'].map((author, index) => ({
        author,
        role: 'Enfermera(o)',
        recordedAt: `2026-07-10T${12 + index}:15:00`,
        source: 'evolution',
        encounterId: encId,
      })),
    }));

    const summary = await runClinicalFill(
      staffingRecord({ H1C2: { encId: 'E1' }, H2C1: { encId: 'E2' } }),
      '2026-07-10',
      staffingDeps({ fetchHistoryScales })
    );

    expect(summary.staffingProposal?.day.names).toEqual([]);
    expect(summary.staffingProposal?.day.ambiguous).toBe(true);
    expect(summary.staffingProposal?.day.candidates).toHaveLength(3);
  });
});
