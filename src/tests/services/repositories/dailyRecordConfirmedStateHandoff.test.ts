import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';
import { createDirectFirestoreWriteReceipt } from '@/services/storage/firestore/firestoreDirectWriteReceipt';

const { saveToIndexedDBMock, isFirestoreEnabledMock } = vi.hoisted(() => ({
  saveToIndexedDBMock: vi.fn(),
  isFirestoreEnabledMock: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  saveRecord: saveToIndexedDBMock,
  saveRecordStrict: saveToIndexedDBMock,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: isFirestoreEnabledMock,
}));
vi.mock('@/services/repositories/dailyRecordRemoteWriteController', () => ({
  resolveRemoteWriteRecovery: vi.fn(),
}));

import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';

const buildRecord = (): DailyRecord =>
  ({
    date: '2026-08-07',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    nurses: [],
    lastUpdated: '2026-08-07T10:00:00.000Z',
  }) as DailyRecord;

describe('daily record confirmed state handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirestoreEnabledMock.mockReturnValue(true);
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-08-07'],
    });
  });

  it('exposes the exact server-confirmed record for the next clinical stage', async () => {
    const state = createRemoteWriteState();
    const staleReadback = vi.fn().mockResolvedValue(buildRecord());
    const confirmedMeta = {
      revision: 40,
      lastMutationId: 'mutation-40',
      updatedAt: '2026-08-07T10:30:00.000Z',
    };
    const confirmedRecord = {
      ...buildRecord(),
      beds: { R1: { bedId: 'R1', patientName: 'Versión confirmada' } },
      lastUpdated: '2026-08-07T10:30:00.000Z',
    } as unknown as DailyRecord;

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-08-07',
      record: buildRecord(),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue({
        recordState: {
          lastUpdated: confirmedRecord.lastUpdated,
          meta: confirmedMeta,
          record: confirmedRecord,
        },
      }),
      readRemoteConfirmedRecord: staleReadback,
      onRemoteFailure: vi.fn(),
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('continue');
    expect(state.confirmedRecord).toBe(confirmedRecord);
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(confirmedRecord);
    expect(staleReadback).not.toHaveBeenCalled();
  });

  it('reads back the committed record when an older callable omits recordState', async () => {
    const state = createRemoteWriteState();
    const confirmedRecord = {
      ...buildRecord(),
      beds: { R2: { bedId: 'R2', patientName: 'Confirmado por lectura remota' } },
      lastUpdated: '2026-08-07T10:45:00.000Z',
    } as unknown as DailyRecord;
    const readRemoteConfirmedRecord = vi.fn().mockResolvedValue(confirmedRecord);

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-08-07',
      record: buildRecord(),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue({ success: true }),
      readRemoteConfirmedRecord,
      onRemoteFailure: vi.fn(),
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('continue');
    expect(readRemoteConfirmedRecord).toHaveBeenCalledOnce();
    expect(state.confirmedRecord).toBe(confirmedRecord);
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(confirmedRecord);
  });

  it('reads back a direct Firestore write that returns no authority payload', async () => {
    const state = createRemoteWriteState();
    const submittedRecord = buildRecord();
    const confirmedRecord = {
      ...submittedRecord,
      lastUpdated: '2026-08-07T10:50:00.000Z',
    } as DailyRecord;
    const readRemoteConfirmedRecord = vi.fn().mockResolvedValue(confirmedRecord);

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-08-07',
      record: submittedRecord,
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue(undefined),
      readRemoteConfirmedRecord,
      requireConfirmedRecord: true,
      onRemoteFailure: vi.fn(),
    });

    expect(result).toBe('continue');
    expect(readRemoteConfirmedRecord).toHaveBeenCalledOnce();
    expect(state.confirmedRecord).toBe(confirmedRecord);
    expect(saveToIndexedDBMock).toHaveBeenNthCalledWith(1, submittedRecord);
    expect(saveToIndexedDBMock).toHaveBeenNthCalledWith(2, confirmedRecord);
  });

  it('reconciles a normal confirmed write before acknowledging its pending outbox task', async () => {
    const state = createRemoteWriteState();
    const submittedRecord = buildRecord();
    const remoteRecord = {
      ...submittedRecord,
      discharges: [{ id: 'egreso-obsoleto', patientName: 'Movimiento remoto obsoleto' }],
      lastUpdated: '2026-08-07T10:50:00.000Z',
    } as unknown as DailyRecord;
    const localProjection = {
      ...remoteRecord,
      discharges: [
        {
          ...remoteRecord.discharges[0],
          deletedAt: '2026-08-07T10:40:00.000Z',
          deletedReason: 'manual_delete',
        },
      ],
    } as DailyRecord;
    const adoptRemoteAuthorityRecord = vi.fn().mockResolvedValue(localProjection);
    const ackLocalAfterRemote = vi.fn().mockResolvedValue(true);

    const result = await persistLocalAndAttemptRemoteSync({
      date: submittedRecord.date,
      record: submittedRecord,
      changedPaths: ['beds.R1'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue({
        recordState: {
          lastUpdated: remoteRecord.lastUpdated,
          meta: { revision: 2 },
          record: remoteRecord,
        },
      }),
      queueLocalBeforeRemote: vi.fn().mockResolvedValue({
        accepted: true,
        mode: 'reused',
        pendingTasks: 1,
        maxPendingTasks: 192,
      }),
      adoptRemoteAuthorityRecord,
      ackLocalAfterRemote,
      onRemoteFailure: vi.fn(),
    });

    expect(result).toBe('continue');
    expect(adoptRemoteAuthorityRecord).toHaveBeenCalledWith(remoteRecord);
    expect(state.localProjectionRecord).toBe(localProjection);
    expect(ackLocalAfterRemote).toHaveBeenCalledOnce();
    expect(vi.mocked(adoptRemoteAuthorityRecord).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ackLocalAfterRemote).mock.invocationCallOrder[0]
    );
    expect(saveToIndexedDBMock).not.toHaveBeenCalled();
  });

  it('fails closed when neither the callable nor a readback confirms the server record', async () => {
    const state = createRemoteWriteState();

    const result = await persistLocalAndAttemptRemoteSync({
      date: '2026-08-07',
      record: buildRecord(),
      changedPaths: ['*'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue({ success: true }),
      onRemoteFailure: vi.fn(),
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('return');
    expect(state.confirmedRecord).toBeUndefined();
    expect(state.consistencyState).toBe('unrecoverable');
    expect(saveToIndexedDBMock).not.toHaveBeenCalled();
  });
});

// The server readback can be answered by a listener that has not seen the commit yet.
describe('daily record confirmed readback guard', () => {
  const expectedVersion = '2026-08-07T09:00:00.000Z';
  const preCommitRecord = { ...buildRecord(), lastUpdated: expectedVersion } as DailyRecord;
  const committedRecord = {
    ...buildRecord(),
    beds: { R1: { bedId: 'R1', patientName: 'Paciente Sintético Confirmado' } },
    lastUpdated: '2026-08-07T10:05:00.000Z',
  } as unknown as DailyRecord;

  const persistWithReadback = (
    readRemoteConfirmedRecord: () => Promise<DailyRecord | null>,
    remoteAuthorityFirst: boolean,
    state = createRemoteWriteState(),
    remoteResult?: unknown,
    baseVersion = expectedVersion
  ) =>
    persistLocalAndAttemptRemoteSync({
      date: '2026-08-07',
      record: buildRecord(),
      changedPaths: ['rayenSync'],
      remoteState: state,
      remoteWrite: vi.fn().mockResolvedValue(remoteResult),
      readRemoteConfirmedRecord,
      requireConfirmedRecord: true,
      remoteAuthorityFirst,
      expectedVersion: baseVersion,
      onRemoteFailure: vi.fn(),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    isFirestoreEnabledMock.mockReturnValue(true);
    saveToIndexedDBMock.mockResolvedValue({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: ['2026-08-07'],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('adopts the committed-record receipt without reading the server back', async () => {
    const state = createRemoteWriteState();
    const readRemoteConfirmedRecord = vi.fn();
    const receipt = createDirectFirestoreWriteReceipt(
      committedRecord,
      new Date(committedRecord.lastUpdated)
    );

    const result = await persistWithReadback(readRemoteConfirmedRecord, true, state, receipt);

    expect(result).toBe('continue');
    expect(readRemoteConfirmedRecord).not.toHaveBeenCalled();
    expect(state.confirmedRecord).toEqual(committedRecord);
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(committedRecord);
  });

  it.each([
    ['remote authority first', true],
    ['local first', false],
  ])('retries a pre-commit readback twice, then fails closed (%s)', async (_label, first) => {
    vi.useFakeTimers();
    const state = createRemoteWriteState();
    const readRemoteConfirmedRecord = vi.fn().mockResolvedValue(preCommitRecord);

    const pending = persistWithReadback(readRemoteConfirmedRecord, first, state);
    await vi.advanceTimersByTimeAsync(249);
    expect(readRemoteConfirmedRecord).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(readRemoteConfirmedRecord).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(750);

    await expect(pending).resolves.toBe('return');
    expect(readRemoteConfirmedRecord).toHaveBeenCalledTimes(3);
    expect(state.confirmedRecord).toBeUndefined();
    expect(state.consistencyState).toBe('unrecoverable');
    expect(saveToIndexedDBMock).not.toHaveBeenCalledWith(preCommitRecord);
  });

  it('treats the base instant written in another ISO form as the pre-commit readback', async () => {
    vi.useFakeTimers();
    const state = createRemoteWriteState();
    const readRemoteConfirmedRecord = vi.fn().mockResolvedValue(preCommitRecord);

    const pending = persistWithReadback(
      readRemoteConfirmedRecord,
      true,
      state,
      undefined,
      '2026-08-07T09:00:00Z'
    );
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe('return');
    expect(readRemoteConfirmedRecord).toHaveBeenCalledTimes(3);
    expect(state.confirmedRecord).toBeUndefined();
  });

  it('accepts the committed record once a retried readback catches up', async () => {
    vi.useFakeTimers();
    const state = createRemoteWriteState();
    const readRemoteConfirmedRecord = vi
      .fn()
      .mockResolvedValueOnce(preCommitRecord)
      .mockResolvedValueOnce(committedRecord);

    const pending = persistWithReadback(readRemoteConfirmedRecord, true, state);
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toBe('continue');
    expect(readRemoteConfirmedRecord).toHaveBeenCalledTimes(2);
    expect(state.confirmedRecord).toBe(committedRecord);
  });

  it('accepts a readback newer than the base version without waiting', async () => {
    const state = createRemoteWriteState();
    const readRemoteConfirmedRecord = vi.fn().mockResolvedValue(committedRecord);

    await expect(persistWithReadback(readRemoteConfirmedRecord, false, state)).resolves.toBe(
      'continue'
    );
    expect(readRemoteConfirmedRecord).toHaveBeenCalledOnce();
    expect(state.confirmedRecord).toBe(committedRecord);
  });
});
