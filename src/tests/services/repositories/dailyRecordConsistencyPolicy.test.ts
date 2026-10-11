// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  resolveDailyRecordReadConsistency,
  resolveDailyRecordSyncConsistency,
} from '@/services/repositories/dailyRecordConsistencyPolicy';

const buildRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordConsistencyPolicy', () => {
  it('marks local record as authoritative when it is newer than remote', () => {
    const local = buildRecord('2026-03-15', '2026-03-15T10:00:00.000Z');
    const remote = buildRecord('2026-03-15', '2026-03-15T08:00:00.000Z');

    const result = resolveDailyRecordReadConsistency({
      localRecord: local,
      remoteRecord: remote,
      selectedRecord: local,
      remoteAvailability: 'resolved',
    });

    expect(result.consistencyState).toBe('local_authoritative');
    expect(result.recoveryAction).toBe('defer_remote_sync');
    expect(result.conflictSummary?.kind).toBe('remote_stale');
  });

  it('marks sync as blocked when remote source is unavailable and keeps local copy', () => {
    const local = buildRecord('2026-03-15', '2026-03-15T10:00:00.000Z');

    const result = resolveDailyRecordSyncConsistency({
      localRecord: local,
      remoteRecord: null,
      selectedRecord: local,
      remoteAvailability: 'unavailable',
    });

    expect(result.consistencyState).toBe('blocked');
    expect(result.sourceOfTruth).toBe('local');
    expect(result.conflictSummary?.kind).toBe('remote_unavailable');
  });
});
