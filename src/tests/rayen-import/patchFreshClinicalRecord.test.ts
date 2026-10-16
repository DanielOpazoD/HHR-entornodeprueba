import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { patchFreshClinicalRecord } from '@/features/rayen-import/hooks/patchFreshClinicalRecord';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

const mocks = vi.hoisted(() => ({
  patchDailyRecordWithCompatibility: vi.fn(),
}));

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: mocks.patchDailyRecordWithCompatibility,
}));

const record = {
  date: '2026-07-27',
  beds: { R1: { bedId: 'R1', clinicalEpisodeId: 'episode-1', devices: ['CUP'] } },
} as unknown as DailyRecord;

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
    vi.resetAllMocks();
    vi.mocked(repository.getForDateWithMeta).mockResolvedValue({ record } as never);
    mocks.patchDailyRecordWithCompatibility.mockResolvedValue(undefined);
  });

  it('keeps the safe history snapshot default when intent is omitted', async () => {
    await patchFreshClinicalRecord(
      repository,
      { 'beds.R1.vitalSigns': { heartRate: 70 } },
      target,
      writeGuard,
      record
    );

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
      { 'beds.R1.vitalSigns': { heartRate: 70 } },
      {
        ...target,
        captureHistorySnapshot: false,
      },
      writeGuard,
      record
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
      writeGuard,
      record
    );

    expect(repository.getForDateWithMeta).toHaveBeenCalledTimes(2);
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
      writeGuard,
      record
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
        writeGuard,
        record
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

    await expect(
      patchFreshClinicalRecord(
        repository,
        { 'beds.R1.vitalSigns': { heartRate: 70 } },
        target,
        writeGuard,
        record
      )
    ).rejects.toThrow('El paciente o su cama cambiaron');

    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(1);
  });

  describe.each(['off', 'shadow'] as const)('%s concurrent edits', mode => {
    const guard = { ...writeGuard, clinicalBatchMode: mode };

    it.each([false, true])('preserves a same-field edit before writing (retry=%s)', async retry => {
      const fresh = {
        ...record,
        beds: { R1: { ...record.beds.R1, devices: ['CUP', 'SNG'] } },
      } as DailyRecord;
      const before = structuredClone(fresh);
      if (retry) {
        vi.mocked(repository.getForDateWithMeta).mockResolvedValueOnce({ record } as never);
        mocks.patchDailyRecordWithCompatibility.mockRejectedValueOnce(
          Object.assign(new Error('Remote is newer'), { name: 'ConcurrencyError' })
        );
      }
      vi.mocked(repository.getForDateWithMeta).mockResolvedValue({ record: fresh } as never);

      await expect(
        patchFreshClinicalRecord(
          repository,
          { 'beds.R1.devices': ['CUP', 'VVP'] },
          target,
          guard,
          record
        )
      ).rejects.toThrow('Un campo clínico cambió');

      expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(retry ? 1 : 0);
      expect(fresh).toEqual(before);
    });

    it('rebases an unchanged field without replacing an unrelated edit', async () => {
      const fresh = {
        ...record,
        beds: { R1: { ...record.beds.R1, pathology: 'Edición local sintética' } },
      } as DailyRecord;
      const conflict = Object.assign(new Error('Remote is newer'), { name: 'ConcurrencyError' });
      vi.mocked(repository.getForDateWithMeta)
        .mockResolvedValueOnce({ record } as never)
        .mockResolvedValueOnce({ record: fresh } as never);
      mocks.patchDailyRecordWithCompatibility.mockRejectedValueOnce(conflict);

      await patchFreshClinicalRecord(
        repository,
        { 'beds.R1.devices': ['CUP', 'VVP'] },
        target,
        guard,
        record
      );

      expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenLastCalledWith(
        repository,
        target.censusDate,
        { 'beds.R1.devices': ['CUP', 'VVP'] },
        expect.objectContaining({ baseRecord: fresh, rayenClinicalWriteGuard: guard })
      );
      expect(fresh.beds.R1.pathology).toBe('Edición local sintética');
    });

    it('does not write values already committed by the competing writer', async () => {
      const fresh = {
        ...record,
        beds: { R1: { ...record.beds.R1, devices: ['CUP', 'VVP'] } },
      } as DailyRecord;
      vi.mocked(repository.getForDateWithMeta).mockResolvedValue({ record: fresh } as never);

      await patchFreshClinicalRecord(
        repository,
        { 'beds.R1.devices': ['CUP', 'VVP'] },
        target,
        guard,
        record
      );

      expect(mocks.patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
    });

    it('protects concurrent clinical crib fields too', async () => {
      const baseCrib = {
        ...record,
        beds: {
          R1: {
            ...record.beds.R1,
            clinicalCrib: { clinicalEpisodeId: 'crib-1', devices: ['CUP'] },
          },
        },
      } as unknown as DailyRecord;
      const fresh = {
        ...baseCrib,
        beds: {
          R1: {
            ...baseCrib.beds.R1,
            clinicalCrib: { ...baseCrib.beds.R1.clinicalCrib, devices: ['CUP', 'SNG'] },
          },
        },
      } as DailyRecord;
      vi.mocked(repository.getForDateWithMeta).mockResolvedValue({ record: fresh } as never);

      await expect(
        patchFreshClinicalRecord(
          repository,
          { 'beds.R1.clinicalCrib.devices': ['CUP', 'VVP'] },
          { ...target, clinicalEpisodeId: 'crib-1', clinicalCrib: true },
          guard,
          baseCrib
        )
      ).rejects.toThrow('Un campo clínico cambió');

      expect(mocks.patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
    });
  });
});
