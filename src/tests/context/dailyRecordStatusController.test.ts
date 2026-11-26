// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDailyRecordStatusModel } from '@/context/dailyRecordStatusController';

describe('dailyRecordStatusController', () => {
  const lastSyncTime = new Date('2026-04-26T10:00:00.000Z');

  it('marks remote hydration as pending independently from save status', () => {
    const model = buildDailyRecordStatusModel({
      syncStatus: 'idle',
      lastSyncTime,
      bootstrapPhase: 'remote_record_bootstrapping',
    });

    expect(model).toEqual({
      syncStatus: 'idle',
      lastSyncTime,
      bootstrapPhase: 'remote_record_bootstrapping',
      isInitialRemoteHydrationPending: true,
      isSaving: false,
      hasError: false,
      isIdle: true,
      isSaved: false,
    });
  });

  it('derives mutually exclusive save flags from sync status', () => {
    expect(
      buildDailyRecordStatusModel({
        syncStatus: 'saving',
        lastSyncTime,
        bootstrapPhase: 'record_ready',
      })
    ).toMatchObject({
      isInitialRemoteHydrationPending: false,
      isSaving: true,
      hasError: false,
      isIdle: false,
      isSaved: false,
    });

    expect(
      buildDailyRecordStatusModel({
        syncStatus: 'error',
        lastSyncTime: null,
        bootstrapPhase: 'record_ready',
      })
    ).toMatchObject({
      isSaving: false,
      hasError: true,
      isIdle: false,
      isSaved: false,
    });
  });
});
