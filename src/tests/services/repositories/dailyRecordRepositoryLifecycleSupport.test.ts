// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { softDeleteDailyRecordRemote } from '@/services/repositories/dailyRecordRepositoryLifecycleSupport';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T08:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordRepositoryLifecycleSupport', () => {
  it('skips remote deletion when remote access is disabled', async () => {
    const loadRecord = vi.fn();
    const moveToTrash = vi.fn();
    const deleteRemote = vi.fn();

    await softDeleteDailyRecordRemote('2026-02-19', {
      isRemoteEnabled: false,
      loadRecord,
      moveToTrash,
      deleteRemote,
    });

    expect(loadRecord).not.toHaveBeenCalled();
    expect(moveToTrash).not.toHaveBeenCalled();
    expect(deleteRemote).not.toHaveBeenCalled();
  });

  it('moves existing record to trash before remote deletion', async () => {
    const record = buildRecord('2026-02-19');
    const loadRecord = vi.fn().mockResolvedValue(record);
    const moveToTrash = vi.fn().mockResolvedValue(undefined);
    const deleteRemote = vi.fn().mockResolvedValue(undefined);

    await softDeleteDailyRecordRemote('2026-02-19', {
      isRemoteEnabled: true,
      loadRecord,
      moveToTrash,
      deleteRemote,
    });

    expect(moveToTrash).toHaveBeenCalledWith(record);
    expect(deleteRemote).toHaveBeenCalledWith('2026-02-19');
  });
});
