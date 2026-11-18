// @vitest-environment node
import { captureAuthoringSession } from '@/services/storage/authoringSession';
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
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-05-23'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists locally and skips remote write when Firestore is disabled', async () => {
    isFirestoreEnabledMock.mockReturnValue(false);
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn();

    const result = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: { date: '2026-05-23', record: buildRecord('2026-05-23'), changedPaths: ['*'] },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
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
    const state = createRemoteWriteState();
    const remoteWrite = vi.fn().mockResolvedValue(undefined);

    const result = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
    });

    expect(result).toBe('continue');
    expect(remoteWrite).toHaveBeenCalledTimes(1);
    expect(state.savedRemotely).toBe(true);
    expect(state.savedLocally).toBe(true);
    expect(state.consistencyState).toBe('persisted_and_synced');
    expect(state.savedLocally).toBe(true);
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
      outbox: { queueLocalBeforeRemote, ackLocalAfterRemote },
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
      },
      remoteState: state,
      remote: {
        remoteWrite: vi.fn().mockResolvedValue(buildAuthorityReceipt()),
        onRemoteFailure: vi.fn(),
      },
      policy: { remoteAuthorityFirst: true },
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
    const ackLocalAfterRemote = vi.fn().mockResolvedValue(undefined);

    const result = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
      },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
      outbox: { queueLocalBeforeRemote, ackLocalAfterRemote },
      policy: { remoteAuthorityFirst: true },
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
      },
      remoteState: state,
      remote: { remoteWrite: vi.fn().mockResolvedValue(undefined), onRemoteFailure: vi.fn() },
      policy: { remoteAuthorityFirst: true },
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
        authoringSession: captureAuthoringSession(),
        change: {
          date: '2026-05-23',
          record: buildRecord('2026-05-23'),
          changedPaths: ['beds.R1.vitalSigns'],
        },
        remoteState: createRemoteWriteState(),
        remote: { remoteWrite: vi.fn().mockRejectedValue(rejection), onRemoteFailure },
        outbox: { queueLocalBeforeRemote },
        policy: { remoteAuthorityFirst: true },
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
      outbox: {
        queueLocalBeforeRemote,
        ackLocalAfterRemote,
        preOutboxHoldRenewal: { renewLocalPreOutboxHold, everyMs: 2_000 },
      },
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

  // W12-CW11: released first, the queue replayed the refused write while its recovery stored it
  // again, which then found no task to fold into and left a second one for the same edit.
  it('keeps a refused direct write held until its recovery has stored it', async () => {
    const steps: string[] = [];
    resolveRemoteWriteRecoveryMock.mockImplementationOnce(async () => {
      steps.push('recovery');
      return {
        status: 'auto_merged',
        queuedForRetry: true,
        autoMerged: true,
        decision: {
          consistencyState: 'auto_merged',
          observabilityTags: ['field_changed_elsewhere'],
          userSafeMessage: 'El campo cambió en otro equipo.',
        },
      };
    });

    const result = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['handoffNovedadesNightShift'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: createRemoteWriteState(),
      remote: {
        remoteWrite: vi.fn().mockRejectedValue(new Error('changed elsewhere')),
        onRemoteFailure: vi.fn(),
      },
      outbox: {
        queueLocalBeforeRemote: vi.fn().mockResolvedValue({
          accepted: true,
          mode: 'created',
          pendingTasks: 1,
          maxPendingTasks: 192,
        }),
        releaseLocalPreOutboxHold: vi.fn(async () => {
          steps.push('release');
        }),
      },
    });

    expect(result).toBe('return');
    expect(steps).toEqual(['recovery', 'release']);
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.patientName'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
      outbox: { queueLocalBeforeRemote },
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
    const state = createRemoteWriteState();
    const remoteError = new Error('remote failed');
    const blockingError = new Error('manual review');
    const onRemoteFailure = vi.fn();
    resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({
      status: 'throw',
      error: blockingError,
      decision: {
        consistencyState: 'unrecoverable',
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.patientName'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: state,
      remote: { remoteWrite: vi.fn().mockRejectedValue(remoteError), onRemoteFailure },
    });

    expect(result).toBe('return');
    expect(onRemoteFailure).toHaveBeenCalledWith(remoteError);
    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith(
      '2026-05-23',
      expect.objectContaining({ date: '2026-05-23' }),
      ['beds.R1.patientName'],
      remoteError,
      captureAuthoringSession(),
      '2026-05-23T10:00:00.000Z',
      true,
      false
    );
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.blockingError).toBe(blockingError);
  });

  it('propagates the no-auto-merge policy for a reclassification conflict', async () => {
    resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({
      status: 'throw',
      error: new Error('reload required'),
      decision: {
        consistencyState: 'unrecoverable',
        observabilityTags: ['reclassification_conflict'],
        userSafeMessage: 'Recarga el censo.',
      },
    });
    const remoteError = new Error('concurrent reclassification');

    await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['discharges', 'cma'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: createRemoteWriteState(),
      remote: { remoteWrite: vi.fn().mockRejectedValue(remoteError), onRemoteFailure: vi.fn() },
      policy: { allowConflictAutoMerge: false },
    });

    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith(
      '2026-05-23',
      expect.objectContaining({ date: '2026-05-23' }),
      ['discharges', 'cma'],
      remoteError,
      captureAuthoringSession(),
      '2026-05-23T10:00:00.000Z',
      false,
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
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remoteState: state,
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
    });

    expect(result).toBe('return');
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state.consistencyState).toBe('unrecoverable');
    expect(state.blockingError).toBe(localError);
    expect(state.conflictSummary).toMatchObject({
      kind: 'local_persistence_failed',
      sourceOfTruth: 'none',
    });
  });
});
