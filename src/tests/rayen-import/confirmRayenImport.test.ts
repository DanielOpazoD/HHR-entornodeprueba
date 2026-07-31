import { describe, expect, it, vi } from 'vitest';
import {
  applyConfirmedRayenImport,
  hasSkippedPreviousDayCorrections,
} from '@/features/rayen-import/hooks/confirmRayenImport';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ApplyResult } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  historicalRecord,
  motherAndNewbornDiff,
  repository,
} from './previousDayAdmissionCorrections.fixtures';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn(),
}));

const record = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

describe('applyConfirmedRayenImport', () => {
  it('retries a named concurrency conflict with a record freshly loaded into the query path', async () => {
    const stale = record('stale');
    const fresh = record('fresh');
    const expected = { record: fresh, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValue(fresh);
    const onRetry = vi.fn();

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: stale,
        diff: {} as CensusImportDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord,
        createId: () => 'id',
        onRetry,
      })
    ).resolves.toBe(expected);
    expect(getFreshRecord).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh, expect.anything());
  });

  it('rebases twice when the census changes again during confirmation', async () => {
    const stale = record('stale');
    const fresh1 = record('fresh-1');
    const fresh2 = record('fresh-2');
    const expected = { record: fresh2, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('El censo se actualizó hace un momento.');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValueOnce(fresh1).mockResolvedValueOnce(fresh2);

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: stale,
        diff: {} as CensusImportDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord,
        createId: () => 'id',
      })
    ).resolves.toBe(expected);

    expect(getFreshRecord).toHaveBeenCalledTimes(2);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh1, expect.anything());
    expect(applyDiff).toHaveBeenNthCalledWith(3, fresh2, expect.anything());
  });

  it('stops after bounded retries when concurrent writes continue', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValue(conflict);
    const getFreshRecord = vi
      .fn()
      .mockResolvedValueOnce(record('fresh-1'))
      .mockResolvedValueOnce(record('fresh-2'));

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: record('stale'),
        diff: {} as CensusImportDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord,
        createId: () => 'id',
      })
    ).rejects.toBe(conflict);

    expect(applyDiff).toHaveBeenCalledTimes(3);
    expect(getFreshRecord).toHaveBeenCalledTimes(2);
  });

  it('retries an accepted previous-day correction after a concurrent revision', async () => {
    const conflict = new Error('El registro ha sido modificado por otro usuario.');
    conflict.name = 'ConcurrencyError';
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockResolvedValueOnce({
        outcome: 'blocked',
        conflictSummary: { kind: 'concurrency' },
        blockingError: conflict,
      } as never)
      .mockResolvedValueOnce({} as never);
    const acceptedDiff = {
      ...motherAndNewbornDiff,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Maeva Elisabet Maria Tuki Garcia', 'RN de Maeva Tuki Garcia'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
          admissionSubjects: [
            { kind: 'principal', bedId: 'H4C1', clinicalEpisodeId: '143100' },
            { kind: 'clinical-crib', bedId: 'H4C1', clinicalEpisodeId: '143101' },
          ],
        },
      ],
    } as CensusImportDiff;
    const expected = {
      record: historicalRecord,
      applied: {},
      skipped: [],
    } as unknown as ApplyResult;
    const applyDiff = vi.fn().mockResolvedValue(expected);
    const onRetry = vi.fn();

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: true,
        base: { ...historicalRecord, date: '2026-07-26' },
        diff: acceptedDiff,
        dailyRecord: repository,
        isAdmin: true,
        ensureRun: () => ({
          id: 'sync-run',
          startedAt: '2026-07-26T10:00:00.000Z',
          by: 'Enfermera prueba',
        }),
        applyDiff,
        getFreshRecord: vi.fn(),
        createId: () => 'movement-id',
        onRetry,
      })
    ).resolves.toBe(expected);

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenCalledTimes(1);
  });
});

describe('hasSkippedPreviousDayCorrections', () => {
  const diffWithPreviousDay = (
    overrides: Partial<NonNullable<CensusImportDiff['previousDayEdits']>[number]> = {}
  ) =>
    ({
      previousDayEdits: [
        {
          day: '2026-07-15',
          reason: 'discharge-day-correction',
          patientNames: ['Paciente prueba'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
          ...overrides,
        },
      ],
    }) as CensusImportDiff;

  it('reports an explicitly unchecked historical correction as skipped', () => {
    expect(hasSkippedPreviousDayCorrections(diffWithPreviousDay(), false)).toBe(true);
  });

  it('reports an unwritable historical correction as skipped', () => {
    expect(
      hasSkippedPreviousDayCorrections(diffWithPreviousDay({ withinEditingWindow: false }), true)
    ).toBe(true);
  });

  it('reports a signed historical correction as skipped', () => {
    expect(hasSkippedPreviousDayCorrections(diffWithPreviousDay({ isSigned: true }), true)).toBe(
      true
    );
  });

  it('does not report an accepted writable correction as skipped', () => {
    expect(hasSkippedPreviousDayCorrections(diffWithPreviousDay(), true)).toBe(false);
  });
});
