// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSyncDailyRecord } from '@/application/daily-record/syncDailyRecordUseCase';
import { DataFactory } from '@/tests/factories/DataFactory';
import type {
  DailyRecordQueryResult,
  DailyRecordQueryRuntime,
} from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const firestore = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => firestore.enabled,
}));

const DATE = '2026-03-05';
const readOf =
  (record: DailyRecord | null, runtime: Partial<DailyRecordQueryRuntime>) =>
  async (): Promise<DailyRecordQueryResult> => ({
    record,
    runtime: {
      date: DATE,
      serverConfirmed: true,
      availabilityState: record ? 'resolved' : 'confirmed_missing',
      consistencyState: record ? 'remote_authoritative' : 'missing',
      sourceOfTruth: record ? 'remote' : 'none',
      retryability: 'not_applicable',
      recoveryAction: 'none',
      conflictSummary: null,
      observabilityTags: [],
      repairApplied: false,
      ...runtime,
    },
  });

describe('syncDailyRecordUseCase', () => {
  beforeEach(() => {
    firestore.enabled = true;
  });

  it('returns success for a day the server confirmed', async () => {
    const record = DataFactory.createMockDailyRecord(DATE);

    const outcome = await executeSyncDailyRecord({ date: DATE, read: readOf(record, {}) });

    expect(outcome.status).toBe('success');
    expect(outcome.data.record).toBe(record);
  });

  it('returns degraded when only this computer’s copy could be shown', async () => {
    const record = DataFactory.createMockDailyRecord(DATE);

    const outcome = await executeSyncDailyRecord({
      date: DATE,
      read: readOf(record, {
        serverConfirmed: false,
        availabilityState: 'recoverable_local',
        consistencyState: 'local_authoritative',
        sourceOfTruth: 'local',
        retryability: 'automatic_retry',
      }),
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

  it('returns partial when the server confirmed the day is absent', async () => {
    const outcome = await executeSyncDailyRecord({
      date: DATE,
      read: readOf(null, { conflictSummary: { kind: 'remote_missing', sourceOfTruth: 'none' } }),
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

  it('returns partial without reading when there is no remote source', async () => {
    firestore.enabled = false;
    const read = vi.fn();

    const outcome = await executeSyncDailyRecord({ date: DATE, read });

    expect(read).not.toHaveBeenCalled();
    expect(outcome.status).toBe('partial');
    expect(outcome.data).toEqual(
      expect.objectContaining({ record: null, degradationReason: 'missing_remote_record' })
    );
    expect(outcome.userSafeMessage).toBe('No hay fuente remota disponible para este día.');
  });

  it('returns failed with an automatic retry when the read throws', async () => {
    const read = vi.fn().mockRejectedValue(new Error('network down'));

    const outcome = await executeSyncDailyRecord({ date: DATE, read });

    expect(outcome.status).toBe('failed');
    expect(outcome.data.record).toBeNull();
    expect(outcome.data.conflict).toEqual(
      expect.objectContaining({ kind: 'sync_failed', retryStrategy: 'automatic_retry' })
    );
    expect(outcome.issues[0]?.message).toBe('network down');
    expect(outcome.reason).toBe('sync_failed');
  });
});
