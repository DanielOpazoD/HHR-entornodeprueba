import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';

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
      onRemoteFailure: vi.fn(),
      remoteAuthorityFirst: true,
    });

    expect(result).toBe('continue');
    expect(state.confirmedRecord).toBe(confirmedRecord);
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(confirmedRecord);
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
});
