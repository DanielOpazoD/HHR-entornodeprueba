import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import {
  applyHistoricalCudyr,
  applyHistoricalCudyrBatch,
  applyHistoricalCudyrBatchAuthoritatively,
} from '@/features/rayen-import/hooks/applyHistoricalCudyr';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn(),
}));

const cudyr: ImportedCudyr = {
  category: 'C1',
  recordedDate: '2026-07-29',
  recordedAt: '2026-07-30T02:15:00Z',
  author: 'Enfermera prueba',
  source: 'Eloísa · Gestión de Camas',
};

const record = (revision: string): DailyRecord =>
  ({
    date: '2026-07-29',
    beds: {
      H2C1: {
        bedId: 'H2C1',
        patientName: 'Paciente',
        clinicalEpisodeId: '142000',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: revision,
  }) as unknown as DailyRecord;

const recordWithTwoEpisodes = (revision: string): DailyRecord =>
  ({
    ...record(revision),
    beds: {
      ...record(revision).beds,
      H2C2: {
        bedId: 'H2C2',
        patientName: 'Paciente dos',
        clinicalEpisodeId: '142001',
      },
    },
  }) as unknown as DailyRecord;

describe('applyHistoricalCudyr', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rehydrates and retries once after a concurrent daily-record change', async () => {
    const repository = {
      getForDateWithMeta: vi
        .fn()
        .mockResolvedValueOnce({ record: record('revision-1') })
        .mockResolvedValueOnce({ record: record('revision-2') }),
    } as unknown as DailyRecordRepositoryPort;
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockResolvedValueOnce({
        outcome: 'unrecoverable',
        blockingError: Object.assign(new Error('Versión remota distinta.'), {
          name: 'VersionMismatchError',
        }),
        conflictSummary: { kind: 'concurrency' },
        userSafeMessage: 'El registro cambió.',
      } as never)
      .mockResolvedValueOnce(null);

    await expect(
      applyHistoricalCudyr({
        dailyRecord: repository,
        clinicalEpisodeId: '142000',
        censusDay: '2026-07-29',
        cudyr,
        isAdmin: true,
      })
    ).resolves.toEqual({ persisted: true, changed: true });

    expect(repository.getForDateWithMeta).toHaveBeenCalledTimes(2);
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(2);
    expect(patchDailyRecordWithCompatibility).toHaveBeenNthCalledWith(
      2,
      repository,
      '2026-07-29',
      { 'beds.H2C1.evaluationScores.cudyr': cudyr },
      { baseRecord: expect.objectContaining({ lastUpdated: 'revision-2' }) }
    );
  });

  it('does not retry a non-concurrent rejection', async () => {
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: record('revision-1') }),
    } as unknown as DailyRecordRepositoryPort;
    vi.mocked(patchDailyRecordWithCompatibility).mockResolvedValueOnce({
      outcome: 'blocked',
      conflictSummary: { kind: 'validation' },
      userSafeMessage: 'Validación fallida.',
    } as never);

    await expect(
      applyHistoricalCudyr({
        dailyRecord: repository,
        clinicalEpisodeId: '142000',
        censusDay: '2026-07-29',
        cudyr,
        isAdmin: true,
      })
    ).rejects.toThrow('Validación fallida.');

    expect(repository.getForDateWithMeta).toHaveBeenCalledOnce();
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledOnce();
  });

  it('persists several historical patients with one census read and one patch', async () => {
    const repository = {
      getForDateWithMeta: vi
        .fn()
        .mockResolvedValue({ record: recordWithTwoEpisodes('revision-1') }),
    } as unknown as DailyRecordRepositoryPort;
    vi.mocked(patchDailyRecordWithCompatibility).mockResolvedValueOnce(null);
    const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };

    await expect(
      applyHistoricalCudyrBatch({
        dailyRecord: repository,
        censusDay: '2026-07-29',
        items: [
          { clinicalEpisodeId: '142000', cudyr },
          { clinicalEpisodeId: '142001', cudyr: secondCudyr },
        ],
        isAdmin: true,
      })
    ).resolves.toEqual([
      { clinicalEpisodeId: '142000', persisted: true, changed: true },
      { clinicalEpisodeId: '142001', persisted: true, changed: true },
    ]);

    expect(repository.getForDateWithMeta).toHaveBeenCalledOnce();
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledOnce();
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-29',
      {
        'beds.H2C1.evaluationScores.cudyr': cudyr,
        'beds.H2C2.evaluationScores.cudyr': secondCudyr,
      },
      { baseRecord: expect.objectContaining({ lastUpdated: 'revision-1' }) }
    );
  });

  it('authorizes a delayed guarded retry from the frozen synchronization date', async () => {
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: record('revision-1') }),
    } as unknown as DailyRecordRepositoryPort;
    vi.mocked(patchDailyRecordWithCompatibility).mockResolvedValueOnce(null);

    await expect(
      applyHistoricalCudyrBatch({
        dailyRecord: repository,
        censusDay: '2026-07-29',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin: true,
        writeGuard: {
          runId: 'run-delayed',
          importMode: 'preview',
          clinicalBatchMode: 'shadow',
          revision: 4,
          sourceDate: '2026-07-30',
          recordScope: 'historical',
        },
      })
    ).resolves.toEqual([{ clinicalEpisodeId: '142000', persisted: true, changed: true }]);

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledOnce();
  });

  it('does not send a guarded historical patch to a day outside its frozen run', async () => {
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: record('revision-1') }),
    } as unknown as DailyRecordRepositoryPort;

    await expect(
      applyHistoricalCudyrBatch({
        dailyRecord: repository,
        censusDay: '2026-07-28',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin: true,
        writeGuard: {
          runId: 'run-delayed',
          importMode: 'preview',
          clinicalBatchMode: 'shadow',
          revision: 4,
          sourceDate: '2026-07-30',
          recordScope: 'historical',
        },
      })
    ).resolves.toEqual([
      {
        clinicalEpisodeId: '142000',
        persisted: false,
        changed: false,
        applicable: false,
      },
    ]);

    expect(repository.getForDateWithMeta).not.toHaveBeenCalled();
    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('persists historical CUDYR through one enforced batch authorized by the source run', async () => {
    const historicalRecord = recordWithTwoEpisodes('revision-1');
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: historicalRecord }),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 2, historySnapshots: 1 });
    const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord,
        censusDay: '2026-07-29',
        items: [
          { clinicalEpisodeId: '142000', cudyr },
          { clinicalEpisodeId: '142001', cudyr: secondCudyr },
        ],
        isAdmin: true,
        runId: 'run-authoritative',
        applyBatch,
      })
    ).resolves.toEqual([
      { clinicalEpisodeId: '142000', persisted: true, changed: true },
      { clinicalEpisodeId: '142001', persisted: true, changed: true },
    ]);

    expect(repository.getForDateWithMeta).toHaveBeenCalledOnce();
    expect(applyBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'enforced',
        record: historicalRecord,
        authorityDate: '2026-07-30',
        runId: 'run-authoritative',
        operations: [
          expect.objectContaining({
            patch: { 'beds.H2C1.evaluationScores': { cudyr } },
          }),
          expect.objectContaining({
            patch: { 'beds.H2C2.evaluationScores': { cudyr: secondCudyr } },
          }),
        ],
      })
    );
    const rebuildOperations = applyBatch.mock.calls[0]?.[0].rebuildOperations as (
      record: DailyRecord
    ) => unknown[];
    const concurrentRecord = {
      ...historicalRecord,
      beds: {
        ...historicalRecord.beds,
        H2C1: {
          ...historicalRecord.beds.H2C1,
          evaluationScores: { braden: { total: 19 } },
        },
      },
    } as unknown as DailyRecord;
    expect(rebuildOperations(concurrentRecord)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patch: { 'beds.H2C1.evaluationScores': { cudyr } },
        }),
      ])
    );
    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it.each([
    { censusDay: '2026-07-28', isAdmin: true, label: 'a day outside the source run' },
    { censusDay: '2026-07-29', isAdmin: false, label: 'a non-admin writer' },
  ])('does not invoke authority for $label', async ({ censusDay, isAdmin }) => {
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: record('revision-1') }),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn();
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord,
        censusDay,
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin,
        runId: 'run-authoritative',
        applyBatch,
      })
    ).resolves.toEqual([
      {
        clinicalEpisodeId: '142000',
        persisted: false,
        changed: false,
        applicable: false,
      },
    ]);

    expect(repository.getForDateWithMeta).not.toHaveBeenCalled();
    expect(applyBatch).not.toHaveBeenCalled();
  });

  it('rebuilds only pending CUDYR operations after a concurrent authoritative write', async () => {
    const initialRecord = {
      ...recordWithTwoEpisodes('revision-1'),
      beds: {
        ...recordWithTwoEpisodes('revision-1').beds,
        H2C1: {
          ...recordWithTwoEpisodes('revision-1').beds.H2C1,
          evaluationScores: { cudyr },
        },
      },
    } as unknown as DailyRecord;
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: initialRecord }),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

    await applyHistoricalCudyrBatchAuthoritatively({
      dailyRecord: repository,
      sourceRecord,
      censusDay: '2026-07-29',
      items: [
        { clinicalEpisodeId: '142000', cudyr },
        { clinicalEpisodeId: '142001', cudyr: secondCudyr },
      ],
      isAdmin: true,
      runId: 'run-authoritative',
      applyBatch,
    });

    const rebuildOperations = applyBatch.mock.calls[0]?.[0].rebuildOperations as (
      record: DailyRecord
    ) => unknown[];
    const concurrentRecord = {
      ...initialRecord,
      beds: {
        H2C2: initialRecord.beds.H2C2,
      },
      lastUpdated: 'revision-2',
    } as unknown as DailyRecord;

    expect(() => rebuildOperations(concurrentRecord)).not.toThrow();
    expect(rebuildOperations(concurrentRecord)).toEqual([
      expect.objectContaining({
        patch: { 'beds.H2C2.evaluationScores': { cudyr: secondCudyr } },
      }),
    ]);
  });
});
