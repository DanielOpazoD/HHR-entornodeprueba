// @vitest-environment node
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
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
import { asStoredDailyRecordShape } from '@/tests/factories/DataFactory';

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
    record: asStoredDailyRecordShape({
      ...buildRecord('2026-05-23'),
      beds: { R1: { bedId: 'R1', patientName: 'Registro preservado por servidor' } },
      lastUpdated: '2026-05-23T10:30:00.000Z',
      meta: {
        revision: 2,
        lastMutationId: 'mutation-2',
        updatedAt: '2026-05-23T10:30:00.000Z',
      },
    }),
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
    const remoteWrite = vi.fn();

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: { date: '2026-05-23', record: buildRecord('2026-05-23'), changedPaths: ['*'] },
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
    });

    expect(result).toBe('continue');
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-05-23' })
    );
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state).toMatchObject({ savedHere: true, state: 'local', cause: 'stored' });
  });

  it('marks the remote state as synced after a successful remote write', async () => {
    const remoteWrite = vi.fn().mockResolvedValue(undefined);

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
    });

    expect(result).toBe('continue');
    expect(remoteWrite).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ savedHere: true, state: 'confirmed', localCopy: 'current' });
  });

  it('uses a transactional outbox preflight instead of a separate local save when provided', async () => {
    const remoteWrite = vi.fn().mockResolvedValue(buildAuthorityReceipt());
    const queueLocalBeforeRemote = vi.fn().mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
    const ackLocalAfterRemote = vi.fn().mockResolvedValue(undefined);

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
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
    expect(state).toMatchObject({ savedHere: true, state: 'confirmed', localCopy: 'current' });
  });

  it('keeps remote authority after a guarded commit when the local cache cannot update', async () => {
    const localError = new Error('indexeddb quota exceeded');
    saveToIndexedDBMock.mockResolvedValue({
      ok: false,
      operation: 'save',
      store: 'none',
      dates: ['2026-05-23'],
      error: localError,
      userSafeMessage: 'No fue posible guardar el registro local.',
    });

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
      },
      remote: {
        remoteWrite: vi.fn().mockResolvedValue(buildAuthorityReceipt()),
        onRemoteFailure: vi.fn(),
      },
      policy: { remoteAuthorityFirst: true },
    });

    expect(result).toBe('return');
    expect(state).toMatchObject({
      savedHere: false,
      state: 'confirmed',
      localCopy: 'stale',
      blockingError: localError,
    });
    expect(state.userSafeMessage).toContain('guardados en el servidor');
    expect(resolveRemoteWriteRecoveryMock).not.toHaveBeenCalled();
  });

  it('commits guarded writes remotely before local persistence and never creates an outbox task', async () => {
    const order: string[] = [];
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

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
      },
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
    expect(state).toMatchObject({ savedHere: true, state: 'confirmed', localCopy: 'current' });
  });

  it('does not cache a guarded write when the server omits its authoritative record state', async () => {
    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.vitalSigns'],
      },
      remote: { remoteWrite: vi.fn().mockResolvedValue(undefined), onRemoteFailure: vi.fn() },
      policy: { remoteAuthorityFirst: true },
    });

    expect(result).toBe('return');
    expect(saveToIndexedDBMock).not.toHaveBeenCalled();
    expect(state).toMatchObject({ savedHere: false, state: 'confirmed', localCopy: 'stale' });
    expect(state.blockingError?.message).toBe(
      'La autoridad remota no devolvió la versión confirmada del registro.'
    );
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
        next: 'return',
        result: {
          date: '2026-05-23',
          savedHere: true,
          state: 'held',
          reason: 'field_changed_elsewhere',
          userSafeMessage: 'El campo cambió en otro equipo.',
        },
      };
    });

    const { next: result } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['handoffNovedadesNightShift'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
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

  // W14-D1-7: the recovery starts from what the write already reached, never from a fresh result.
  it('hands its recovery the confirmed result when the outbox ack fails after the server took it', async () => {
    const ackError = new Error('synthetic ack failure');
    const receipt = buildAuthorityReceipt();
    resolveRemoteWriteRecoveryMock.mockImplementationOnce(async ({ current }) => ({
      result: current,
      next: 'continue',
    }));

    const { result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remote: { remoteWrite: vi.fn().mockResolvedValue(receipt), onRemoteFailure: vi.fn() },
      outbox: {
        queueLocalBeforeRemote: vi.fn().mockResolvedValue({
          accepted: true,
          mode: 'created',
          pendingTasks: 1,
          maxPendingTasks: 192,
        }),
        ackLocalAfterRemote: vi.fn().mockRejectedValue(ackError),
      },
    });

    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ackError,
        current: expect.objectContaining({
          savedHere: true,
          state: 'confirmed',
          localCopy: 'current',
          confirmedRecord: receipt.recordState.record,
        }),
      })
    );
    expect(state).toMatchObject({
      state: 'confirmed',
      confirmedRecord: receipt.recordState.record,
    });
  });

  // W14-D1-3: each way a write meets an ended session names it; the notice and the guards read it.
  describe('a session that ended before the write finished', () => {
    const departedSession = { ownerKey: 'user:synthetic-departed', generation: 'departed' };
    const change = {
      date: '2026-05-23',
      record: buildRecord('2026-05-23'),
      changedPaths: ['handoffNovedadesNightShift'],
      expectedVersion: '2026-05-23T10:00:00.000Z',
    };
    const acceptedOutbox = () =>
      vi.fn().mockResolvedValue({
        accepted: true,
        mode: 'created',
        pendingTasks: 1,
        maxPendingTasks: 192,
      });

    it('server first: nothing is sent and the reason says the session changed', async () => {
      const remoteWrite = vi.fn();

      const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
        authoringSession: departedSession,
        change,
        remote: { remoteWrite, onRemoteFailure: vi.fn() },
        policy: { remoteAuthorityFirst: true },
      });

      expect(result).toBe('return');
      expect(remoteWrite).not.toHaveBeenCalled();
      expect(state).toMatchObject({
        savedHere: false,
        state: 'not_saved',
        reason: 'session_changed',
      });
    });

    it('the queue kept the edit for its author: the reason says the session changed', async () => {
      const remoteWrite = vi.fn();

      const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
        authoringSession: captureAuthoringSession(),
        change,
        remote: { remoteWrite, onRemoteFailure: vi.fn() },
        outbox: {
          queueLocalBeforeRemote: vi.fn().mockResolvedValue({
            accepted: false,
            mode: 'retained_for_owner',
            pendingTasks: 1,
            maxPendingTasks: 192,
          }),
        },
      });

      expect(result).toBe('return');
      expect(remoteWrite).not.toHaveBeenCalled();
      expect(state).toMatchObject({
        savedHere: false,
        state: 'not_saved',
        reason: 'session_changed',
      });
      expect(state.userSafeMessage).toBe(
        'La sesión cambió antes de guardar. El cambio quedó pendiente para la persona que lo hizo.'
      );
    });

    it('direct send: the edit stays queued for its author with the reason', async () => {
      const releaseLocalPreOutboxHold = vi.fn().mockResolvedValue(undefined);

      const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
        authoringSession: departedSession,
        change,
        remote: {
          remoteWrite: vi.fn().mockRejectedValue(new Error('La sesión cambió antes de enviar.')),
          onRemoteFailure: vi.fn(),
        },
        outbox: { queueLocalBeforeRemote: acceptedOutbox(), releaseLocalPreOutboxHold },
      });

      expect(result).toBe('return');
      expect(resolveRemoteWriteRecoveryMock).not.toHaveBeenCalled();
      expect(releaseLocalPreOutboxHold).toHaveBeenCalledTimes(1);
      expect(state).toMatchObject({ savedHere: true, state: 'held', reason: 'session_changed' });
    });

    it('a refusal while the session is current carries no session reason', async () => {
      const retrying: DailyRecordWriteResult = {
        date: '2026-05-23',
        savedHere: true,
        state: 'local',
        cause: 'retrying',
      };
      resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({ result: retrying, next: 'continue' });

      const { result: state } = await persistLocalAndAttemptRemoteSync({
        authoringSession: captureAuthoringSession(),
        change,
        remote: {
          remoteWrite: vi.fn().mockRejectedValue(new Error('network down')),
          onRemoteFailure: vi.fn(),
        },
        outbox: { queueLocalBeforeRemote: acceptedOutbox() },
      });

      expect(state).toBe(retrying);
      expect(state).not.toHaveProperty('reason');
    });
  });

  it('blocks the remote write when transactional outbox preflight is rejected', async () => {
    const remoteWrite = vi.fn().mockResolvedValue(undefined);
    const queueLocalBeforeRemote = vi.fn().mockResolvedValue({
      accepted: false,
      mode: 'rejected_backpressure',
      pendingTasks: 192,
      maxPendingTasks: 192,
    });

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.patientName'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
      outbox: { queueLocalBeforeRemote },
    });

    expect(result).toBe('return');
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state).toMatchObject({ savedHere: false, state: 'not_saved', reason: 'local_failed' });
    expect(state.userSafeMessage).toContain('alcanzó su límite operativo');
    expect(state.blockingError?.message).toContain('alcanzó su límite operativo');
  });

  it('returns the recovery result of a failed remote write', async () => {
    const remoteError = new Error('remote failed');
    const blockingError = new Error('manual review');
    const onRemoteFailure = vi.fn();
    const recovered: DailyRecordWriteResult = {
      date: '2026-05-23',
      savedHere: true,
      state: 'held',
      reason: 'needs_review',
      userSafeMessage: 'Revisar manualmente.',
      blockingError,
    };
    resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({ result: recovered, next: 'return' });

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['beds.R1.patientName'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remote: { remoteWrite: vi.fn().mockRejectedValue(remoteError), onRemoteFailure },
    });

    expect(result).toBe('return');
    expect(onRemoteFailure).toHaveBeenCalledWith(remoteError);
    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith({
      date: '2026-05-23',
      record: expect.objectContaining({ date: '2026-05-23' }),
      changedPaths: ['beds.R1.patientName'],
      error: remoteError,
      // The write was stored here before its remote step failed.
      current: { date: '2026-05-23', savedHere: true, state: 'local', cause: 'stored' },
      authoringSession: captureAuthoringSession(),
      expectedVersion: '2026-05-23T10:00:00.000Z',
      allowConflictAutoMerge: true,
      localWriteAlreadyQueued: false,
    });
    expect(state).toBe(recovered);
  });

  it('propagates the no-auto-merge policy for a reclassification conflict', async () => {
    resolveRemoteWriteRecoveryMock.mockResolvedValueOnce({
      next: 'return',
      result: {
        date: '2026-05-23',
        savedHere: true,
        state: 'held',
        reason: 'needs_review',
        concurrencyConflict: true,
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
      remote: { remoteWrite: vi.fn().mockRejectedValue(remoteError), onRemoteFailure: vi.fn() },
      policy: { allowConflictAutoMerge: false },
    });

    expect(resolveRemoteWriteRecoveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        changedPaths: ['discharges', 'cma'],
        error: remoteError,
        allowConflictAutoMerge: false,
        localWriteAlreadyQueued: false,
      })
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
    const remoteWrite = vi.fn().mockResolvedValue(undefined);

    const { next: result, result: state } = await persistLocalAndAttemptRemoteSync({
      authoringSession: captureAuthoringSession(),
      change: {
        date: '2026-05-23',
        record: buildRecord('2026-05-23'),
        changedPaths: ['*'],
        expectedVersion: '2026-05-23T10:00:00.000Z',
      },
      remote: { remoteWrite, onRemoteFailure: vi.fn() },
    });

    expect(result).toBe('return');
    expect(remoteWrite).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      savedHere: false,
      state: 'not_saved',
      reason: 'local_failed',
      blockingError: localError,
      userSafeMessage: 'No fue posible guardar el registro local.',
    });
  });
});
