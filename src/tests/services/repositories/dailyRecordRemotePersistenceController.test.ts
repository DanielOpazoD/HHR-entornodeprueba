import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';

const { saveToIndexedDBMock, isFirestoreEnabledMock, resolveRemoteWriteRecoveryMock } = vi.hoisted(
  () => ({
    saveToIndexedDBMock: vi.fn(),
    isFirestoreEnabledMock: vi.fn(),
    resolveRemoteWriteRecoveryMock: vi.fn(),
  })
);

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  saveRecord: saveToIndexedDBMock,
  saveRecordStrict: saveToIndexedDBMock,
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: isFirestoreEnabledMock,
}));

vi.mock('@/services/repositories/dailyRecordRemoteWriteController', () => ({
  resolveRemoteWriteRecovery: resolveRemoteWriteRecoveryMock,
}));

import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

const buildAuthorityReceipt = () => ({
  recordState: {
    lastUpdated: '2026-05-23T10:30:00.000Z',
    meta: {
      revision: 2,
      lastMutationId: 'mutation-2',
      updatedAt: '2026-05-23T10:30:00.000Z',
    },
    record: {
      ...buildRecord('2026-05-23'),
      beds: { R1: { bedId: 'R1', patientName: 'Registro preservado por servidor' } },
      lastUpdated: '2026-05-23T10:30:00.000Z',
      meta: {
        revision: 2,
        lastMutationId: 'mutation-2',
        updatedAt: '2026-05-23T10:30:00.000Z',
      },
    } as unknown as DailyRecord,
  },
});

describe('dailyRecordRemotePersistenceController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirestoreEnabledMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists locally and skips remote write when Firestore is disabled', async () => {
    isFirestoreEnabledMock.mockReturnValue(false);
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-05-23'],
    });
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn();

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
    });

    expect(result).toBe('continue');
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-05-23' })
    );
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state.savedLocally).toBe(true);
    expect(state.savedRemotely).toBe(false);
    expect(state.consistencyState).toBe('persisted_local_only');
  });

  it('marks the remote state as synced after a successful remote write', async () => {
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-05-23'],
    });
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn().mockResolvedValue(undefined);

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
    });

    expect(result).toBe('continue');
    expect(remoteWrite).toHaveBeenCalledTimes(1);
    expect(state.savedRemotely).toBe(true);
    expect(state.savedLocally).toBe(true);
    expect(state.consistencyState).toBe('persisted_and_synced');
    expect(state.savedLocally).toBe(true);
    expect(state.recoveryAction).toBe('none');
    expect(state.observabilityTags).toEqual(['daily_record', 'write', 'persisted_and_synced']);
  });

  it('uses a transactional outbox preflight instead of a separate local save when provided', async () => {
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn().mockResolvedValue(buildAuthorityReceipt());
    const queueLocalBeforeRemote = vi.fn().mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
    const ackLocalAfterRemote = vi.fn().mockResolvedValue(undefined);

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
      queueLocalBeforeRemote,
      ackLocalAfterRemote,
    });

    expect(result).toBe('continue');
    expect(queueLocalBeforeRemote).toHaveBeenCalledTimes(1);
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: { R1: expect.objectContaining({ patientName: 'Registro preservado por servidor' }) },
        lastUpdated: '2026-05-23T10:30:00.000Z',
      })
    );
    expect(remoteWrite).toHaveBeenCalledTimes(1);
    expect(ackLocalAfterRemote).toHaveBeenCalledTimes(1);
    expect(state.consistencyState).toBe('persisted_and_synced');
    expect(state.savedRemotely).toBe(true);
    expect(state.savedLocally).toBe(true);
  });

  it('keeps remote authority after a guarded commit when the local cache cannot update', async () => {
    const localError = new Error('indexeddb quota exceeded');
    const state = createRemoteWriteState();
    saveToIndexedDBMock.mockResolvedValue({
      ok: false,
      operation: 'save',
      store: 'none',
      dates: ['2026-05-23'],
      error: localError,
      userSafeMessage: 'No fue posible guardar el registro local.',
    });

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.vitalSigns'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue(buildAuthorityReceipt()),
      onRemoteFailure: vi.fn(),
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('return');
    expect(state.savedRemotely).toBe(true);
    expect(state.savedLocally).toBe(false);
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.conflictSummary).toMatchObject({
      kind: 'local_persistence_failed',
      sourceOfTruth: 'remote',
    });
    expect(state.userSafeMessage).toContain('guardados en el servidor');
    expect(state.observabilityTags).toEqual([
      'daily_record',
      'write',
      'remote_committed',
      'local_cache_stale',
    ]);
    expect(resolveRemoteWriteRecoveryMock).not.toHaveBeenCalled();
  });

  it('commits guarded writes remotely before local persistence and never creates an outbox task', async () => {
    const order: string[] = [];
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn().mockImplementation(async () => {
      order.push('remote');
      return buildAuthorityReceipt();
    });
    saveToIndexedDBMock.mockImplementation(async () => {
      order.push('local');
      return {
        ok: true,
        operation: 'save',
        store: 'indexeddb',
        dates: ['2026-05-23'],
      };
    });
    const queueLocalBeforeRemote = vi.fn();

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.vitalSigns'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
      queueLocalBeforeRemote,
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('continue');
    expect(order).toEqual(['remote', 'local']);
    expect(queueLocalBeforeRemote).not.toHaveBeenCalled();
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUpdated: '2026-05-23T10:30:00.000Z',
        meta: expect.objectContaining({ revision: 2, lastMutationId: 'mutation-2' }),
        beds: { R1: expect.objectContaining({ patientName: 'Registro preservado por servidor' }) },
      })
    );
    expect(state.consistencyState).toBe('persisted_and_synced');
  });

  it('does not cache a guarded write when the server omits its authoritative record state', async () => {
    const state = createRemoteWriteState();

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.vitalSigns'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue(undefined),
      onRemoteFailure: vi.fn(),
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('return');
    expect(saveToIndexedDBMock).not.toHaveBeenCalled();
    expect(state.savedRemotely).toBe(true);
    expect(state.savedLocally).toBe(false);
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.userSafeMessage).toContain('guardados en el servidor');
  });

  it('does not persist or enqueue a guarded write rejected by remote authority', async () => {
    const rejection = new Error('policy changed');
    const onRemoteFailure = vi.fn();
    const queueLocalBeforeRemote = vi.fn();

    await expect(
      persistLocalAndAttemptRemoteSync({
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
        remoteState: createRemoteWriteState(),
        remoteWrite: vi.fn().mockRejectedValue(rejection),
        onRemoteFailure,
        queueLocalBeforeRemote,
        remoteAuthorityFirst: true,
      })
    ).rejects.toBe(rejection);

    expect(onRemoteFailure).toHaveBeenCalledWith(rejection);
    expect(saveToIndexedDBMock).not.toHaveBeenCalled();
    expect(queueLocalBeforeRemote).not.toHaveBeenCalled();
    expect(resolveRemoteWriteRecoveryMock).not.toHaveBeenCalled();
  });

  it('renews the pre-outbox hold while a direct remote write is still in flight', async () => {
    vi.useFakeTimers();
    const state = createRemoteWriteState();
    const queueLocalBeforeRemote = vi.fn().mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
    const ackLocalAfterRemote = vi.fn().mockResolvedValue(undefined);
    const renewLocalPreOutboxHold = vi.fn().mockResolvedValue(undefined);
    let resolveRemoteWrite: (() => void) | undefined;
    const remoteWrite = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveRemoteWrite = resolve;
        })
    );

    const pending = persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
      queueLocalBeforeRemote,
      ackLocalAfterRemote,
      renewLocalPreOutboxHold,
      renewLocalPreOutboxHoldEveryMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(renewLocalPreOutboxHold).toHaveBeenCalledTimes(1);

    resolveRemoteWrite?.();
    await pending;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(remoteWrite).toHaveBeenCalledTimes(1);
    expect(ackLocalAfterRemote).toHaveBeenCalledTimes(1);
    expect(renewLocalPreOutboxHold).toHaveBeenCalledTimes(1);
  });

  it('blocks the remote write when transactional outbox preflight is rejected', async () => {
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn().mockResolvedValue(undefined);
    const queueLocalBeforeRemote = vi.fn().mockResolvedValue({
      accepted: false,
      mode: 'rejected_backpressure',
      pendingTasks: 192,
      maxPendingTasks: 192,
    });

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.patientName'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
      queueLocalBeforeRemote,
    });

    expect(result).toBe('return');
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.conflictSummary).toMatchObject({
      kind: 'local_persistence_failed',
      sourceOfTruth: 'none',
      changedPaths: ['beds.R1.patientName'],
    });
  });

  it('applies recovery and returns early when remote recovery asks to throw', async () => {
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-05-23'],
    });
    const state = createRemoteWriteState();
    const remoteError = new Error('remote failed');
    const blockingError = new Error('manual review');
    const onRemoteFailure = vi.fn();
    resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({
      status: 'throw',
      error: blockingError,
      decision: {
        consistencyState: 'unrecoverable',
        retryability: 'manual_review',
        recoveryAction: 'block_and_surface',
        conflictSummary: {
          kind: 'remote_unavailable',
          sourceOfTruth: 'none',
          message: 'remote failed',
        },
        observabilityTags: ['daily_record', 'write', 'unrecoverable'],
        userSafeMessage: 'Revisar manualmente.',
      },
    });

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['beds.R1.patientName'],
      remoteState: state,
      remoteWrite: vi.fn().mockRejectedValue(remoteError),
      onRemoteFailure,
      expectedVersion: '2026-05-23T10:00:00.000Z',
    });

    expect(result).toBe('return');
    expect(onRemoteFailure).toHaveBeenCalledWith(remoteError);
    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith(
      '2026-05-23',
      expect.objectContaining({ date: '2026-05-23' }),
      ['beds.R1.patientName'],
      remoteError,
      '2026-05-23T10:00:00.000Z',
      true
    );
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.blockingError).toBe(blockingError);
  });

  it('propagates the no-auto-merge policy for a reclassification conflict', async () => {
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-05-23'],
    });
    resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({
      status: 'throw',
      error: new Error('reload required'),
      decision: {
        consistencyState: 'unrecoverable',
        retryability: 'manual_review',
        recoveryAction: 'block_and_surface',
        observabilityTags: ['reclassification_conflict'],
        userSafeMessage: 'Recarga el censo.',
      },
    });
    const remoteError = new Error('concurrent reclassification');

    await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['discharges', 'cma'],
      remoteState: createRemoteWriteState(),
      remoteWrite: vi.fn().mockRejectedValue(remoteError),
      onRemoteFailure: vi.fn(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
      allowConflictAutoMerge: false,
    });

    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith(
      '2026-05-23',
      expect.objectContaining({ date: '2026-05-23' }),
      ['discharges', 'cma'],
      remoteError,
      '2026-05-23T10:00:00.000Z',
      false
    );
  });

  it('blocks remote writes when strict local persistence fails', async () => {
    const localError = new Error('indexeddb quota exceeded');
    saveToIndexedDBMock.mockResolvedValue({
      ok: false,
      operation: 'save',
      store: 'none',
      dates: ['2026-05-23'],
      error: localError,
      userSafeMessage: 'No fue posible guardar el registro local.',
    });
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn().mockResolvedValue(undefined);

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite,
      onRemoteFailure: vi.fn(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
    });

    expect(result).toBe('return');
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.recoveryAction).toBe('block_and_surface');
    expect(state.blockingError).toBe(localError);
    expect(state.conflictSummary).toMatchObject({
      kind: 'local_persistence_failed',
      sourceOfTruth: 'none',
    });
  });
});
