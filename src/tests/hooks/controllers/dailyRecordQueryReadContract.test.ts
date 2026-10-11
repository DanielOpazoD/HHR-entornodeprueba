import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  createDailyRecordQueryFn,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn(), recordError: vi.fn() },
}));

describe('daily record metadata read contract', () => {
  it('builds query functions and cache keys consistently', async () => {
    const record = DataFactory.createMockDailyRecord('2025-01-08');
    const repository = {
      getForDateWithMeta: vi
        .fn()
        .mockResolvedValue(createDailyRecordReadResult(record.date, record, 'indexeddb')),
    };

    await expect(createDailyRecordQueryFn(repository, '2025-01-08')()).resolves.toMatchObject({
      record,
      runtime: {
        availabilityState: 'recoverable_local',
        consistencyState: 'local_only',
      },
    });
    expect(repository.getForDateWithMeta).toHaveBeenCalledWith('2025-01-08', true);
    expect(getDailyRecordQueryKey('2025-01-08')).toEqual(['dailyRecord', '2025-01-08']);
  });

  it.each(['missing', 'unavailable'] as const)(
    'preserves repository %s metadata for an empty read',
    async consistencyState => {
      const result = createDailyRecordReadResult('2025-01-08', null, 'not_found', {
        consistencyState,
        retryability: consistencyState === 'unavailable' ? 'automatic_retry' : 'not_applicable',
        userSafeMessage: consistencyState === 'unavailable' ? 'Read unavailable' : undefined,
      });
      const repository = { getForDateWithMeta: vi.fn().mockResolvedValue(result) };

      await expect(createDailyRecordQueryFn(repository, result.date)()).resolves.toMatchObject({
        record: null,
        runtime: {
          availabilityState:
            consistencyState === 'unavailable' ? 'temporarily_unavailable' : 'confirmed_missing',
          consistencyState,
          retryability: result.retryability,
          sourceOfTruth: result.sourceOfTruth,
          userSafeMessage: result.userSafeMessage,
        },
      });
    }
  );

  it('builds query functions without forcing remote sync before the runtime is ready', async () => {
    const record = DataFactory.createMockDailyRecord('2025-01-08');
    const repository = {
      getForDateWithMeta: vi.fn().mockResolvedValue({
        date: '2025-01-08',
        record,
        source: 'indexeddb',
        compatibilityTier: 'none',
        compatibilityIntensity: 'none',
        migrationRulesApplied: [],
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      }),
    };

    await expect(
      createDailyRecordQueryFn(repository, '2025-01-08', false)()
    ).resolves.toMatchObject({
      record,
      runtime: {
        sourceOfTruth: 'local',
      },
    });
    expect(repository.getForDateWithMeta).toHaveBeenCalledWith('2025-01-08', false);
  });
});
