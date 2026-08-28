import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: {
      H1C2: {
        bedId: 'H1C2',
        patientName: 'Paciente',
        clinicalEpisodeId: 'E1',
        devices: [],
      },
    },
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
  now: () => new Date('2026-07-10T12:00:00.000Z'),
  createId: () => 'id-1',
  ...over,
});

describe('current CUDYR administrative authority', () => {
  it.each([
    {
      label: 'Eloísa reports a different value',
      items: [
        {
          encId: 'E1',
          crdValue: 'C2',
          crdDateTime: '2026-07-10T18:00:00+00:00',
          source: 'gestion_camas' as const,
        },
      ],
    },
    { label: 'Eloísa reports no value', items: [] },
  ])('preserves an administrative adjustment when $label', async ({ items }) => {
    const current = record();
    (current.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      braden: { total: 17 },
      downton: { total: 2 },
      cudyr: {
        category: 'D2',
        recordedDate: '2026-07-10',
        source: 'HHR · ajuste administrativo',
      },
    };
    const input = deps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items,
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(current, '2026-07-10', input);

    expect(summary.errors).toEqual([]);
    expect(summary.performance?.counters.administrativeOverridesPreserved).toBe(1);
    const patch = (input.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].cudyr).toEqual({
      category: 'D2',
      recordedDate: '2026-07-10',
      source: 'HHR · ajuste administrativo',
    });
    expect(current.beds.H1C2.evaluationScores).toMatchObject({
      braden: { total: 17 },
      downton: { total: 2 },
      cudyr: { category: 'D2', source: 'HHR · ajuste administrativo' },
    });
  });

  it('continues updating a normal value imported from Eloísa', async () => {
    const current = record();
    (current.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      cudyr: {
        category: 'B1',
        recordedDate: '2026-07-10',
        source: 'Eloísa · Gestión de Camas',
      },
    };
    const input = deps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-10T18:00:00+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(current, '2026-07-10', input);

    expect(summary.errors).toEqual([]);
    expect(summary.performance?.counters.administrativeOverridesPreserved).toBeUndefined();
    const patch = (input.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores']).toMatchObject({
      cudyr: { category: 'C2', source: 'Eloísa · Gestión de Camas' },
    });
  });
});
