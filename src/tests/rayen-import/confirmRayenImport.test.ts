import { describe, expect, it, vi } from 'vitest';
import {
  applyConfirmedRayenImport,
  areRayenStructuralPlansEquivalent,
  RayenStructuralPlanChangedError,
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

const structuralDiff = (overrides: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
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

describe('applyConfirmedRayenImport', () => {
  it('retries a named concurrency conflict with a record freshly loaded into the query path', async () => {
    const stale = record('stale');
    const fresh = record('fresh');
    const initialDiff = {} as CensusImportDiff;
    const replannedDiff = { unchangedCount: 1 } as CensusImportDiff;
    const expected = { record: fresh, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValue(fresh);
    const replanDiff = vi.fn().mockResolvedValue(replannedDiff);
    const onRetry = vi.fn();

    const result = await applyConfirmedRayenImport({
      applyPreviousDays: false,
      base: stale,
      diff: initialDiff,
      dailyRecord: {} as DailyRecordRepositoryPort,
      isAdmin: false,
      ensureRun: vi.fn(),
      applyDiff,
      getFreshRecord,
      replanDiff,
      createId: () => 'id',
      onRetry,
    });

    expect(result).toEqual({
      ...expected,
      appliedDiff: replannedDiff,
      historicalCorrectionsPending: false,
    });
    expect(getFreshRecord).toHaveBeenCalledTimes(1);
    expect(replanDiff).toHaveBeenCalledWith(fresh);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenNthCalledWith(1, stale, initialDiff, undefined);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh, replannedDiff, undefined);
  });

  it('rebases twice when the census changes again during confirmation', async () => {
    const stale = record('stale');
    const fresh1 = record('fresh-1');
    const fresh2 = record('fresh-2');
    const initialDiff = {} as CensusImportDiff;
    const replannedDiff1 = { unchangedCount: 1 } as CensusImportDiff;
    const replannedDiff2 = { unchangedCount: 2 } as CensusImportDiff;
    const expected = { record: fresh2, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('El censo se actualizó hace un momento.');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValueOnce(fresh1).mockResolvedValueOnce(fresh2);
    const replanDiff = vi
      .fn()
      .mockResolvedValueOnce(replannedDiff1)
      .mockResolvedValueOnce(replannedDiff2);

    const result = await applyConfirmedRayenImport({
      applyPreviousDays: false,
      base: stale,
      diff: initialDiff,
      dailyRecord: {} as DailyRecordRepositoryPort,
      isAdmin: false,
      ensureRun: vi.fn(),
      applyDiff,
      getFreshRecord,
      replanDiff,
      createId: () => 'id',
    });

    expect(result).toEqual({
      ...expected,
      appliedDiff: replannedDiff2,
      historicalCorrectionsPending: false,
    });

    expect(getFreshRecord).toHaveBeenCalledTimes(2);
    expect(replanDiff).toHaveBeenNthCalledWith(1, fresh1);
    expect(replanDiff).toHaveBeenNthCalledWith(2, fresh2);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh1, replannedDiff1, undefined);
    expect(applyDiff).toHaveBeenNthCalledWith(3, fresh2, replannedDiff2, undefined);
  });

  it('stops after bounded retries when concurrent writes continue', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValue(conflict);
    const getFreshRecord = vi
      .fn()
      .mockResolvedValueOnce(record('fresh-1'))
      .mockResolvedValueOnce(record('fresh-2'));
    const replanDiff = vi.fn().mockResolvedValue({} as CensusImportDiff);

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
        replanDiff,
        createId: () => 'id',
      })
    ).rejects.toBe(conflict);

    expect(applyDiff).toHaveBeenCalledTimes(3);
    expect(getFreshRecord).toHaveBeenCalledTimes(2);
    expect(replanDiff).toHaveBeenCalledTimes(2);
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
    const replanDiff = vi.fn();
    const onRetry = vi.fn();

    const result = await applyConfirmedRayenImport({
      applyPreviousDays: true,
      base: { ...historicalRecord, date: '2026-07-26' },
      diff: acceptedDiff,
      dailyRecord: repository,
      isAdmin: true,
      ensureRun: () => ({
        id: 'sync-run',
        startedAt: '2026-07-26T10:00:00.000Z',
        by: 'Enfermera prueba',
        sourceDate: '2026-07-26',
      }),
      applyDiff,
      getFreshRecord: vi.fn(),
      replanDiff,
      createId: () => 'movement-id',
      onRetry,
    });

    expect(result).toEqual({
      ...expected,
      appliedDiff: acceptedDiff,
      historicalCorrectionsPending: false,
    });

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenCalledTimes(1);
    expect(replanDiff).not.toHaveBeenCalled();
  });

  it('preserves the confirmed selected day when historical corrections exhaust retries', async () => {
    const conflict = new Error('El registro ha sido modificado por otro usuario.');
    conflict.name = 'ConcurrencyError';
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockReset()
      .mockResolvedValue({
        outcome: 'blocked',
        conflictSummary: { kind: 'concurrency' },
        blockingError: conflict,
      } as never);
    const acceptedDiff = {
      ...motherAndNewbornDiff,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Maeva Elisabet Maria Tuki Garcia'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
          admissionSubjects: [{ kind: 'principal', bedId: 'H4C1', clinicalEpisodeId: '143100' }],
        },
      ],
    } as CensusImportDiff;
    const expected = {
      record: historicalRecord,
      applied: {},
      skipped: [],
    } as unknown as ApplyResult;

    const caught = await applyConfirmedRayenImport({
      applyPreviousDays: true,
      base: { ...historicalRecord, date: '2026-07-26' },
      diff: acceptedDiff,
      dailyRecord: repository,
      isAdmin: true,
      ensureRun: () => ({
        id: 'sync-run',
        startedAt: '2026-07-26T10:00:00.000Z',
        by: 'Enfermera prueba',
        sourceDate: '2026-07-26',
      }),
      applyDiff: vi.fn().mockResolvedValue(expected),
      getFreshRecord: vi.fn(),
      replanDiff: vi.fn(),
      createId: () => 'movement-id',
    }).catch(error => error as unknown);

    expect(caught).toMatchObject({
      name: 'RayenHistoricalCorrectionAfterCommitError',
      committedResult: {
        ...expected,
        appliedDiff: acceptedDiff,
        historicalCorrectionsPending: false,
      },
    });
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(3);
  });

  it('reports a non-durable historical validation failure without losing the selected-day commit', async () => {
    const historicalFailure = new Error('El día histórico quedó firmado durante la corrección.');
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockReset()
      .mockResolvedValue({
        outcome: 'blocked',
        blockingError: historicalFailure,
      } as never);
    const acceptedDiff = {
      ...motherAndNewbornDiff,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Maeva Elisabet Maria Tuki Garcia'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
          admissionSubjects: [{ kind: 'principal', bedId: 'H4C1', clinicalEpisodeId: '143100' }],
        },
      ],
    } as CensusImportDiff;
    const expected = {
      record: historicalRecord,
      applied: {},
      skipped: [],
    } as unknown as ApplyResult;

    const caught = await applyConfirmedRayenImport({
      applyPreviousDays: true,
      base: { ...historicalRecord, date: '2026-07-26' },
      diff: acceptedDiff,
      dailyRecord: repository,
      isAdmin: true,
      ensureRun: () => ({
        id: 'sync-run',
        startedAt: '2026-07-26T10:00:00.000Z',
        by: 'Enfermera prueba',
        sourceDate: '2026-07-26',
      }),
      applyDiff: vi.fn().mockResolvedValue(expected),
      getFreshRecord: vi.fn(),
      replanDiff: vi.fn(),
      createId: () => 'movement-id',
    }).catch(error => error as unknown);

    expect(caught).toMatchObject({
      name: 'RayenHistoricalCorrectionAfterCommitError',
      committedResult: {
        ...expected,
        appliedDiff: acceptedDiff,
        historicalCorrectionsPending: false,
      },
    });
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledOnce();
  });

  it('marks a historical correction pending only after its exact outbox write is durable', async () => {
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockReset()
      .mockResolvedValue({
        outcome: 'blocked',
        savedLocally: true,
        updatedRemotely: false,
        queuedForRetry: false,
      } as never);
    const acceptedDiff = {
      ...motherAndNewbornDiff,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Maeva Elisabet Maria Tuki Garcia'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
          admissionSubjects: [{ kind: 'principal', bedId: 'H4C1', clinicalEpisodeId: '143100' }],
        },
      ],
    } as CensusImportDiff;
    const expected = {
      record: historicalRecord,
      applied: {},
      skipped: [],
    } as unknown as ApplyResult;

    const result = await applyConfirmedRayenImport({
      applyPreviousDays: true,
      base: { ...historicalRecord, date: '2026-07-26' },
      diff: acceptedDiff,
      dailyRecord: repository,
      isAdmin: true,
      ensureRun: () => ({
        id: 'sync-run',
        startedAt: '2026-07-26T10:00:00.000Z',
        by: 'Enfermera prueba',
        sourceDate: '2026-07-26',
      }),
      applyDiff: vi.fn().mockResolvedValue(expected),
      getFreshRecord: vi.fn(),
      replanDiff: vi.fn(),
      createId: () => 'movement-id',
    });

    expect(result).toMatchObject({
      record: expected.record,
      appliedDiff: acceptedDiff,
      historicalCorrectionsPending: true,
    });
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledOnce();
  });

  it('returns a materially changed replan to review before applying historical corrections', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const initialDiff = { ...motherAndNewbornDiff, previousDayEdits: [] } as CensusImportDiff;
    const replannedDiff = {
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
    const stale = { ...historicalRecord, date: '2026-07-26', lastUpdated: 'stale' };
    const fresh = { ...stale, lastUpdated: 'fresh' };
    const applyDiff = vi.fn().mockRejectedValueOnce(conflict);
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockReset()
      .mockResolvedValue({} as never);

    const caught = await applyConfirmedRayenImport({
      applyPreviousDays: true,
      base: stale,
      diff: initialDiff,
      dailyRecord: repository,
      isAdmin: true,
      ensureRun: () => ({
        id: 'sync-run',
        startedAt: '2026-07-26T10:00:00.000Z',
        by: 'Enfermera prueba',
        sourceDate: '2026-07-26',
      }),
      applyDiff,
      getFreshRecord: vi.fn().mockResolvedValue(fresh),
      replanDiff: vi.fn().mockResolvedValue(replannedDiff),
      clinicalDay: '2026-07-26',
      createId: () => 'movement-id',
    }).catch(error => error as unknown);

    expect(caught).toBeInstanceOf(RayenStructuralPlanChangedError);
    expect(caught).toMatchObject({
      name: 'RayenStructuralPlanChangedError',
      freshRecord: fresh,
      replannedDiff,
    });

    expect(applyDiff).toHaveBeenCalledOnce();
    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });
});

describe('areRayenStructuralPlansEquivalent', () => {
  it('ignores audit-only unchanged counters while preserving the reviewed operations', () => {
    expect(
      areRayenStructuralPlansEquivalent(
        structuralDiff({ unchangedCount: 1 }),
        structuralDiff({ unchangedCount: 9 })
      )
    ).toBe(true);
  });

  it('detects a newly introduced admission before a CAS retry', () => {
    expect(
      areRayenStructuralPlansEquivalent(
        structuralDiff(),
        structuralDiff({
          admissions: [
            {
              bedId: 'H1C1',
              patient: { patientName: 'Paciente nuevo' } as never,
              isCma: false,
            },
          ],
        })
      )
    ).toBe(false);
  });
});
