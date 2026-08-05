import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { patchFreshClinicalRecord } from '@/features/rayen-import/hooks/patchFreshClinicalRecord';

const mocks = vi.hoisted(() => ({
  patchDailyRecordWithCompatibility: vi.fn(),
  assertClinicalFillPatchTarget: vi.fn(),
}));

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: mocks.patchDailyRecordWithCompatibility,
}));

vi.mock('@/features/rayen-import/domain/clinicalFillPatchTarget', () => ({
  assertClinicalFillPatchTarget: mocks.assertClinicalFillPatchTarget,
}));

const record = {
  date: '2026-07-27',
  beds: { R1: { bedId: 'R1', clinicalEpisodeId: 'episode-1' } },
};

const repository = {
  getForDateWithMeta: vi.fn().mockResolvedValue({ record }),
} as unknown as DailyRecordRepositoryPort;

const target = {
  censusDate: '2026-07-27',
  bedId: 'R1',
  clinicalEpisodeId: 'episode-1',
};
const writeGuard = {
  runId: 'run-1',
  importMode: 'preview' as const,
  clinicalBatchMode: 'shadow' as const,
  revision: 4,
  sourceDate: '2026-07-27',
  recordScope: 'run' as const,
};

describe('patchFreshClinicalRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patchDailyRecordWithCompatibility.mockResolvedValue(undefined);
  });

  it('keeps the safe history snapshot default when intent is omitted', async () => {
    await patchFreshClinicalRecord(repository, { 'beds.R1.pathology': 'X' }, target, writeGuard);

    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-27',
      expect.any(Object),
      expect.objectContaining({
        historyPolicy: 'snapshot',
        rayenClinicalWriteGuard: writeGuard,
      })
    );
  });

  it('skips a second snapshot only when the coordinator explicitly requests it', async () => {
    await patchFreshClinicalRecord(
      repository,
      { 'beds.R1.pathology': 'X' },
      {
        ...target,
        captureHistorySnapshot: false,
      },
      writeGuard
    );

    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-27',
      expect.any(Object),
      expect.objectContaining({ historyPolicy: 'skip' })
    );
  });

  it('retries one concurrent clinical write against freshly hydrated census truth', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    mocks.patchDailyRecordWithCompatibility
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);

    await patchFreshClinicalRecord(
      repository,
      { 'beds.R1.vitalSigns': { heartRate: 70 } },
      target,
      writeGuard
    );

    expect(repository.getForDateWithMeta).toHaveBeenCalledTimes(2);
    expect(mocks.assertClinicalFillPatchTarget).toHaveBeenCalledTimes(2);
    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(2);
  });

  it('retries a structured concurrency rejection even when its blocking error has another name', async () => {
    const blockingError = new Error('Remote is newer');
    blockingError.name = 'VersionMismatchError';
    mocks.patchDailyRecordWithCompatibility
      .mockResolvedValueOnce({
        outcome: 'unrecoverable',
        blockingError,
        conflictSummary: { kind: 'concurrency' },
      } as never)
      .mockResolvedValueOnce(undefined);

    await patchFreshClinicalRecord(
      repository,
      { 'beds.R1.vitalSigns': { heartRate: 70 } },
      target,
      writeGuard
    );

    expect(repository.getForDateWithMeta).toHaveBeenCalledTimes(2);
    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-concurrent clinical write failure', async () => {
    mocks.patchDailyRecordWithCompatibility.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      patchFreshClinicalRecord(
        repository,
        { 'beds.R1.vitalSigns': { heartRate: 70 } },
        target,
        writeGuard
      )
    ).rejects.toThrow('permission-denied');

    expect(repository.getForDateWithMeta).toHaveBeenCalledTimes(1);
    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(1);
  });

  it('stops the retry if the patient moved before the fresh attempt', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const movedRecord = {
      ...record,
      beds: { R1: { bedId: 'R1', clinicalEpisodeId: 'another-episode' } },
    };
    vi.mocked(repository.getForDateWithMeta)
      .mockResolvedValueOnce({ record } as never)
      .mockResolvedValueOnce({ record: movedRecord } as never);
    mocks.patchDailyRecordWithCompatibility.mockRejectedValueOnce(conflict);
    mocks.assertClinicalFillPatchTarget.mockImplementationOnce(() => undefined);
    mocks.assertClinicalFillPatchTarget.mockImplementationOnce(() => {
      throw new Error('El episodio cambió de cama.');
    });

    await expect(
      patchFreshClinicalRecord(
        repository,
        { 'beds.R1.vitalSigns': { heartRate: 70 } },
        target,
        writeGuard
      )
    ).rejects.toThrow('El episodio cambió de cama.');

    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(1);
  });
});
