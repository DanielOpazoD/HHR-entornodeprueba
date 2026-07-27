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

describe('patchFreshClinicalRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patchDailyRecordWithCompatibility.mockResolvedValue(undefined);
  });

  it('keeps the safe history snapshot default when intent is omitted', async () => {
    await patchFreshClinicalRecord(repository, { 'beds.R1.pathology': 'X' }, target);

    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-27',
      expect.any(Object),
      expect.objectContaining({ historyPolicy: 'snapshot' })
    );
  });

  it('skips a second snapshot only when the coordinator explicitly requests it', async () => {
    await patchFreshClinicalRecord(
      repository,
      { 'beds.R1.pathology': 'X' },
      {
        ...target,
        captureHistorySnapshot: false,
      }
    );

    expect(mocks.patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-27',
      expect.any(Object),
      expect.objectContaining({ historyPolicy: 'skip' })
    );
  });
});
