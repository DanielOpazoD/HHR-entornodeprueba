import { describe, expect, it, vi } from 'vitest';
import { executeSyncDailyRecord } from '@/application/daily-record/syncDailyRecordUseCase';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('syncDailyRecordUseCase', () => {
  it('returns success for clean sync', async () => {
    const record = DataFactory.createMockDailyRecord('2026-03-05');
    const repository = {
      syncWithFirestoreDetailed: vi.fn().mockResolvedValue({
        date: '2026-03-05',
        consistencyState: 'clean',
        record,
      }),
    };

    const outcome = await executeSyncDailyRecord({
      date: '2026-03-05',
      repository,
    });

    expect(outcome.status).toBe('success');
    expect(outcome.data.record).toBe(record);
  });

  it('returns degraded for blocked sync', async () => {
    const record = DataFactory.createMockDailyRecord('2026-03-05');
    const repository = {
      syncWithFirestoreDetailed: vi.fn().mockResolvedValue({
        date: '2026-03-05',
        consistencyState: 'blocked',
        record,
      }),
    };

    const outcome = await executeSyncDailyRecord({
      date: '2026-03-05',
      repository,
    });

    expect(outcome.status).toBe('degraded');
    expect(outcome.data.degradationReason).toBe('remote_blocked');
    expect(outcome.data.conflict).toEqual(
      expect.objectContaining({
        kind: 'remote_blocked',
        retryStrategy: 'manual_review',
        recommendedAction: 'continue_with_local_copy',
      })
    );
    expect(outcome.reason).toBe('remote_blocked');
    expect(outcome.retryable).toBe(true);
  });

  it('returns partial for missing remote data', async () => {
    const repository = {
      syncWithFirestoreDetailed: vi.fn().mockResolvedValue({
        date: '2026-03-05',
        consistencyState: 'missing_remote',
        record: null,
      }),
    };

    const outcome = await executeSyncDailyRecord({
      date: '2026-03-05',
      repository,
    });

    expect(outcome.status).toBe('partial');
    expect(outcome.data.degradationReason).toBe('missing_remote_record');
    expect(outcome.data.conflict).toEqual(
      expect.objectContaining({
        kind: 'missing_remote_record',
        recommendedAction: 'review_remote_record',
      })
    );
    expect(outcome.reason).toBe('missing_remote_record');
    expect(outcome.userSafeMessage).toContain('registro remoto');
  });

  it('returns partial when the repository has no remote source', async () => {
    const repository = { syncWithFirestoreDetailed: vi.fn().mockResolvedValue(null) };

    const outcome = await executeSyncDailyRecord({ date: '2026-03-05', repository });

    expect(outcome.status).toBe('partial');
    expect(outcome.data).toEqual(
      expect.objectContaining({
        record: null,
        sync: null,
        degradationReason: 'missing_remote_record',
      })
    );
    expect(outcome.userSafeMessage).toBe('No hay fuente remota disponible para este día.');
  });

  it('returns failed with an automatic retry when the repository throws', async () => {
    const repository = {
      syncWithFirestoreDetailed: vi.fn().mockRejectedValue(new Error('network down')),
    };

    const outcome = await executeSyncDailyRecord({ date: '2026-03-05', repository });

    expect(outcome.status).toBe('failed');
    expect(outcome.data.record).toBeNull();
    expect(outcome.data.conflict).toEqual(
      expect.objectContaining({ kind: 'sync_failed', retryStrategy: 'automatic_retry' })
    );
    expect(outcome.issues[0]?.message).toBe('network down');
    expect(outcome.reason).toBe('sync_failed');
  });
});
