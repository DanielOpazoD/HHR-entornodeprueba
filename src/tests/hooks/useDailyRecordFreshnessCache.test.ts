import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDailyRecordRemoteFreshness } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';

describe('daily record freshness cache', () => {
  const date = '2026-05-16';

  beforeEach(() => {
    setFirestoreEnabled(true);
    vi.clearAllMocks();
  });

  it('stores a direct freshness read in React Query cache when no cached record exists', async () => {
    const queryClient = createTestQueryClient();
    const remoteRecord = DataFactory.createMockDailyRecord(date);
    remoteRecord.beds.R1.pathology = 'Diagnostico Firebase';
    const queryFn = vi.fn().mockResolvedValue(
      createDailyRecordQueryResult(remoteRecord, {
        date,
        availabilityState: 'resolved',
        consistencyState: 'remote_authoritative',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      })
    );

    await ensureDailyRecordRemoteFreshness({
      date,
      queryClient,
      queryFn,
      reason: 'clinical_patch',
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<ReturnType<typeof createDailyRecordQueryResult>>(
        getDailyRecordQueryKey(date)
      )?.record?.beds.R1.pathology
    ).toBe('Diagnostico Firebase');
  });
});
