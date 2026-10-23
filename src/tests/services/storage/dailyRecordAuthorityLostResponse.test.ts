import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
const { invoke, readServer } = vi.hoisted(() => ({ invoke: vi.fn(), readServer: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => invoke }));
vi.mock('firebase/firestore', () => ({ getDocFromServer: readServer }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: async () => ({}) },
}));
vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  getRecordDocRef: (date: string) => `hospitals/hanga_roa/dailyRecords/${date}`,
  docToRecord: (data: DailyRecord) => data,
}));
import {
  patchDailyRecordWithClinicalAuthorityCallable as patch,
  saveDailyRecordWithClinicalAuthorityCallable as save,
  type DailyRecordAuthorityCallablePayload,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { AUTHORITY_READBACK_TIMEOUT_MS } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const date = '2026-10-19';
const record = {
  date,
  lastUpdated: `${date}T10:00:00.000Z`,
  beds: {},
  discharges: [],
} as unknown as DailyRecord;
const payload: DailyRecordAuthorityCallablePayload = {
  date,
  record,
  mode: 'enforced',
  syncContract: { mutationId: 'synthetic-mutation' },
};
const failure = (code = 'deadline-exceeded') =>
  Object.assign(new Error('Synthetic lost response'), { code: `functions/${code}` });
const committed = () => ({
  ...record,
  lastUpdated: `${date}T10:01:00.000Z`,
  meta: { revision: 2, lastMutationId: 'synthetic-mutation' },
  cudyrLocked: true,
  beds: { R1: { patientName: 'Paciente sintético', cudyr: { changeClothes: 2 } } },
});
const snapshot = (
  data = committed(),
  metadata = { fromCache: false, hasPendingWrites: false }
) => ({
  exists: () => true,
  data: () => data,
  metadata,
});

beforeEach(() => {
  vi.clearAllMocks();
  readServer.mockResolvedValue(snapshot());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('authority commit with lost response', () => {
  it.each(['save', 'patch'] as const)(
    'confirms %s with one read and no second write, retaining server CUDYR',
    async kind => {
      invoke.mockRejectedValueOnce(failure());
      const result =
        kind === 'save'
          ? await save(payload)
          : await patch({ ...payload, patch: { nurses: ['Sintética'] } });
      expect(result).toMatchObject({
        success: true,
        mutationId: 'synthetic-mutation',
        revision: 2,
        recordState: { record: committed() },
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(readServer).toHaveBeenCalledTimes(1);
      expect(readServer).toHaveBeenCalledWith(`hospitals/hanga_roa/dailyRecords/${date}`);
      expect(result.recordState?.record.beds).toEqual(committed().beds);
      expect(payload.record).toEqual(record);
    }
  );

  it('returns the original normal receipt without another query', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, date } });
    expect(await save(payload)).toEqual({ success: true, date });
    expect(readServer).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'internal', 'unknown'])(
    'recovers ambiguous %s only with the exact receipt',
    async code => {
      invoke.mockRejectedValueOnce(failure(code));
      expect((await save(payload)).success).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    'permission-denied',
    'unauthenticated',
    'invalid-argument',
    'failed-precondition',
    'not-found',
  ])('does not reinterpret a definitive %s rejection', async code => {
    const error = failure(code);
    invoke.mockRejectedValueOnce(error);
    await expect(save(payload)).rejects.toBe(error);
    expect(readServer).not.toHaveBeenCalled();
  });

  it('confirms a commit stamped with a Firestore Timestamp, as the authority callables write it', async () => {
    const stamp = { toMillis: () => Date.parse(`${date}T10:01:00.000Z`) };
    invoke.mockRejectedValueOnce(failure());
    readServer.mockResolvedValueOnce(snapshot({ ...committed(), lastUpdated: stamp } as never));
    await expect(save(payload)).resolves.toMatchObject({
      success: true,
      mutationId: 'synthetic-mutation',
      revision: 2,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'different mutation',
      () => ({ ...committed(), meta: { revision: 3, lastMutationId: 'newer-write' } }),
    ],
    ['different day', () => ({ ...committed(), date: '2026-10-18' })],
    [
      'missing revision',
      () => ({ ...committed(), meta: { lastMutationId: 'synthetic-mutation' } }),
    ],
    ['invalid timestamp', () => ({ ...committed(), lastUpdated: 'invalid' })],
    ['invalid Timestamp', () => ({ ...committed(), lastUpdated: { toMillis: () => NaN } })],
    ['numeric stamp', () => ({ ...committed(), lastUpdated: 1_792_000_000_000 })],
    ['missing stamp', () => ({ ...committed(), lastUpdated: null })],
    ['plain map stamp', () => ({ ...committed(), lastUpdated: { seconds: 1 } })],
  ] as const)('retains the error for %s even when patient values match', async (_label, data) => {
    const error = failure();
    invoke.mockRejectedValueOnce(error);
    readServer.mockResolvedValueOnce({ ...snapshot(), data });
    await expect(save(payload)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { fromCache: true, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true },
  ])('rejects unconfirmed snapshot metadata %j', async metadata => {
    const error = failure();
    invoke.mockRejectedValueOnce(error);
    readServer.mockResolvedValueOnce(snapshot(committed(), metadata));
    await expect(save(payload)).rejects.toBe(error);
  });

  it.each([{ dryRun: true }, { mode: 'shadow' as const }, { syncContract: {} }])(
    'does not recover non-committing or unidentified calls %j',
    async overrides => {
      const error = failure();
      invoke.mockRejectedValueOnce(error);
      await expect(save({ ...payload, ...overrides })).rejects.toBe(error);
      expect(readServer).not.toHaveBeenCalled();
    }
  );

  it.each(['missing', 'unavailable'])(
    'retains the original error when the read is %s',
    async kind => {
      const error = failure();
      invoke.mockRejectedValueOnce(error);
      if (kind === 'missing') readServer.mockResolvedValueOnce({ exists: () => false });
      else readServer.mockRejectedValueOnce(new Error('Read unavailable'));
      await expect(save(payload)).rejects.toBe(error);
    }
  );

  it('bounds readback and ignores a receipt arriving after the deadline', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    readServer.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const error = failure();
    invoke.mockRejectedValueOnce(error);
    const outcome = save(payload).catch(cause => cause);
    await vi.waitFor(() => expect(readServer).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(AUTHORITY_READBACK_TIMEOUT_MS);
    expect(await outcome).toBe(error);
    finish(snapshot());
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
