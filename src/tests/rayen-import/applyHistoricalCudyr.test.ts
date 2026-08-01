import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import {
  applyHistoricalCudyr,
  applyHistoricalCudyrBatch,
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
});
