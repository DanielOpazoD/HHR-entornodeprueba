import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import {
  setAcknowledgedDailyRecordQueryData,
  setRemoteConfirmedDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: vi.fn(),
    recordError: vi.fn(),
  },
}));

describe('daily record acknowledged cache provenance', () => {
  afterEach(() => {
    clearPendingDailyRecordPatchesForTests();
  });

  it('keeps an explicitly retained copy local even when it matches the confirmed record', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const confirmed = DataFactory.createMockDailyRecord(date);
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmed);

    await setAcknowledgedDailyRecordQueryData(
      queryClient,
      date,
      structuredClone(confirmed),
      confirmed,
      undefined,
      { retainedProjection: true }
    );

    expect(queryClient.getQueryData(getDailyRecordQueryKey(date))).toMatchObject({
      record: confirmed,
      runtime: {
        sourceOfTruth: 'local',
        consistencyState: 'local_only',
        observabilityTags: ['daily_record', 'write', 'local_projection'],
      },
    });
  });

  it('publishes a save without server confirmation as a local record', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const localRecord = DataFactory.createMockDailyRecord(date);

    await setAcknowledgedDailyRecordQueryData(queryClient, date, localRecord);

    expect(queryClient.getQueryData(getDailyRecordQueryKey(date))).toMatchObject({
      record: localRecord,
      runtime: { sourceOfTruth: 'local', consistencyState: 'local_only' },
    });
  });

  it('publishes an equivalent local projection clone as the confirmed remote record', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const confirmedRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
      rayenSyncHistory: [
        {
          id: 'run-current',
          sourceDate: date,
          startedAt: '2025-01-08T10:09:00.000Z',
          completedAt: '2025-01-08T10:10:00.000Z',
          by: 'Enfermera Demo',
          status: 'partial' as const,
        },
      ],
    };
    const localProjectionClone = structuredClone(confirmedRecord);

    await setAcknowledgedDailyRecordQueryData(
      queryClient,
      date,
      localProjectionClone,
      confirmedRecord
    );

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: confirmedRecord,
      runtime: { sourceOfTruth: 'remote', consistencyState: 'remote_authoritative' },
    });
  });
});
