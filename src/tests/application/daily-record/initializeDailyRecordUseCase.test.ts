import { describe, expect, it, vi } from 'vitest';
import { executeInitializeDailyRecord } from '@/application/daily-record/initializeDailyRecordUseCase';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('initializeDailyRecordUseCase', () => {
  it('returns success for clean initialization', async () => {
    const record = DataFactory.createMockDailyRecord('2026-03-05');
    const repository = {
      initializeDay: vi.fn().mockResolvedValue({
        record,
        date: '2026-03-05',
        outcome: 'clean',
        sourceCompatibilityIntensity: 'none',
        sourceMigrationRulesApplied: [],
      }),
    };

    const outcome = await executeInitializeDailyRecord({
      date: '2026-03-05',
      repository,
    });

    expect(outcome.status).toBe('success');
    expect(outcome.data.record).toBe(record);
  });

  it('returns degraded for repaired initialization', async () => {
    const record = DataFactory.createMockDailyRecord('2026-03-05');
    const repository = {
      initializeDay: vi.fn().mockResolvedValue({
        record,
        date: '2026-03-05',
        outcome: 'repaired',
        sourceCompatibilityIntensity: 'legacy_schema_bridge',
        sourceMigrationRulesApplied: ['bridge-legacy'],
      }),
    };

    const outcome = await executeInitializeDailyRecord({
      date: '2026-03-05',
      copySource: DataFactory.createMockDailyRecord('2026-03-04'),
      repository,
    });

    expect(outcome.status).toBe('degraded');
    expect(outcome.issues[0]?.code).toBe('legacy_schema_bridge');
  });

  it('returns failed without a record when the repository throws', async () => {
    const repository = { initializeDay: vi.fn().mockRejectedValue(new Error('disk full')) };

    const outcome = await executeInitializeDailyRecord({ date: '2026-03-05', repository });

    expect(outcome.status).toBe('failed');
    expect(outcome.data.record).toBeNull();
    expect(outcome.issues[0]?.message).toBe('disk full');
  });
});
