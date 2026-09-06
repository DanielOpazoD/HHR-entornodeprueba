import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (beds: Record<string, { encId?: string }>): DailyRecord =>
  ({
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
  }) as unknown as DailyRecord;

const deps = (over: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
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

describe('runClinicalFill staffing inference', () => {
  it('registers discovered staff even when no shift can be inferred and reports a storage failure', async () => {
    const activity = {
      author: 'Ana Soto Rojas',
      role: 'Enfermera(o)',
      recordedAt: '2026-07-10T10:15:00',
      source: 'evolution',
    };
    const registerStaff = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const summary = await runClinicalFill(
      record({ H1C2: { encId: 'E1' } }),
      '2026-07-10',
      deps({
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
          recordedAt: encId === 'E1' ? '2026-07-10T10:15:00' : '2026-07-10T14:15:00',
          source: 'evolution',
        },
        {
          author: 'Jimena Yáñez',
          role: 'Paramédico',
          recordedAt: encId === 'E1' ? '2026-07-10T11:15:00' : '2026-07-10T15:15:00',
          source: 'evolution',
        },
      ],
    }));

    const summary = await runClinicalFill(
      record({ H1C2: { encId: 'E1' }, H2C1: { encId: 'E2' } }),
      '2026-07-10',
      deps({ fetchHistoryScales })
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
      record({ H1C2: { encId: 'E1' } }),
      '2026-07-10',
      deps({
        nurseCatalog: ['Camila Soto'],
        fetchHistoryScales: vi.fn().mockResolvedValue({
          events: [],
          nursingActivity: [
            {
              author: 'Camila Soto Alegria',
              authorIdentity: { firstGivenName: 'Camila', firstSurname: 'Soto' },
              role: 'Enfermera(o)',
              recordedAt: '2026-07-10T10:20:00',
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
      record({ H1C2: { encId: 'E1' } }),
      '2026-07-10',
      deps({
        tensCatalog: ['Jimena Yáñez'],
        fetchHistoryScales: vi.fn().mockResolvedValue({
          events: [],
          nursingActivity: [
            {
              author: 'Jimena Yañez',
              role: 'Paramédico',
              recordedAt: '2026-07-10T15:20:00',
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
        recordedAt: `2026-07-10T${10 + index}:15:00`,
        source: 'evolution',
        encounterId: encId,
      })),
    }));

    const summary = await runClinicalFill(
      record({ H1C2: { encId: 'E1' }, H2C1: { encId: 'E2' } }),
      '2026-07-10',
      deps({ fetchHistoryScales })
    );

    expect(summary.staffingProposal?.day.names).toEqual([]);
    expect(summary.staffingProposal?.day.ambiguous).toBe(true);
    expect(summary.staffingProposal?.day.candidates).toHaveLength(3);
  });
});
