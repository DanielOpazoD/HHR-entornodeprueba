import { fileCrossDayCorrections } from '@/features/rayen-import/domain/previousDayCorrections';
import { expect, it, vi } from 'vitest';
import { applyConfirmedRayenImport } from '@/features/rayen-import/hooks/confirmRayenImport';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

vi.mock('@/features/rayen-import/domain/previousDayCorrections', () => ({
  fileCrossDayCorrections: vi
    .fn()
    .mockResolvedValue({ confirmed: 0, durablyQueued: 0, omitted: [] }),
}));

const record = (lastUpdated: string): DailyRecord => ({
  date: '2026-07-16',
  lastUpdated,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
});
const structuralDiff = (overrides: Partial<CensusImportDiff>): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...overrides,
});

it('never starts historical recovery when the operator confirms only the selected date', async () => {
  const ensureRun = vi.fn();
  const base = record('revision');
  const proposed = structuralDiff({
    historicalRecovery: [
      {
        day: '2026-07-15',
        recordExists: false,
        withinEditingWindow: true,
        isSigned: false,
        admissions: [],
        reportEgresos: [],
        conflicts: [],
      },
    ],
  });
  const applyDiff = vi.fn().mockResolvedValue({ record: base, applied: {}, skipped: [] });
  await applyConfirmedRayenImport({
    applyPreviousDays: false,
    base,
    diff: proposed,
    dailyRecord: {} as DailyRecordRepositoryPort,
    isAdmin: true,
    ensureRun,
    applyDiff,
    getFreshRecord: async () => base,
    replanDiff: async () => proposed,
    createId: () => 'id',
  });
  expect(applyDiff).toHaveBeenCalledOnce();
  expect(ensureRun).not.toHaveBeenCalled();
});

it.each([
  ['2026-07-16', '2026-07-15', '2026-07-15'],
  ['2026-07-14', '2026-07-16', '2026-07-14'],
])(
  'corrige días previos respetando censo %s y turno congelado %s',
  async (selectedDay, clinicalDay, expectedDay) => {
    vi.mocked(fileCrossDayCorrections).mockClear();
    const base = { ...record('revision'), date: selectedDay };
    const proposed = structuralDiff({});
    await applyConfirmedRayenImport({
      applyPreviousDays: true,
      base,
      diff: proposed,
      dailyRecord: {} as DailyRecordRepositoryPort,
      isAdmin: true,
      ensureRun: () => ({
        id: 'run',
        by: 'Prueba',
        sourceDate: selectedDay,
        startedAt: '2026-07-16T12:00:00Z',
      }),
      applyDiff: vi.fn().mockResolvedValue({ record: base, applied: {}, skipped: [] }),
      getFreshRecord: async () => base,
      replanDiff: async () => proposed,
      createId: () => 'id',
      clinicalDay,
    });
    expect(vi.mocked(fileCrossDayCorrections).mock.calls[0][3]).toBe(expectedDay);
  }
);
