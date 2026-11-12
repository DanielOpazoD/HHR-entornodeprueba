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

const respondRead = (read: () => unknown) =>
  readServer.mockImplementation(async ref => {
    expect(ref).toBe(`hospitals/hanga_roa/dailyRecords/${date}`);
    return read();
  });
const rejectCall = (error: Error) =>
  invoke.mockImplementation(async actual => {
    expect(actual.date).toBe(date);
    expect(actual.mode).toBe('enforced');
    throw error;
  });

beforeEach(() => {
  vi.resetAllMocks();
  respondRead(() => snapshot());
});

it('checks the leaving session again after loading the callable, before sending any payload', async () => {
  let allowed = true;
  const pending = save(payload, () => {
    if (!allowed) throw new Error('Synthetic session changed during module load');
  });
  allowed = false;
  await expect(pending).rejects.toThrow('Synthetic session changed');
  expect(invoke).not.toHaveBeenCalled();
  expect(readServer).not.toHaveBeenCalled();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('authority commit with lost response', () => {
  it('returns the original normal receipt without another query', async () => {
    invoke.mockImplementation(async actual => {
      expect(actual).toMatchObject(payload);
      return { data: { success: true, date } };
    });
    expect(await save(payload)).toEqual({ success: true, date });
    expect(readServer).not.toHaveBeenCalled();
  });

  it.each([
    'permission-denied',
    'unauthenticated',
    'invalid-argument',
    'failed-precondition',
    'not-found',
  ])('does not reinterpret a definitive %s rejection', async code => {
    const error = failure(code);
    rejectCall(error);
    await expect(save(payload)).rejects.toBe(error);
    expect(readServer).not.toHaveBeenCalled();
  });

  it('retains the error for an invalid Timestamp object the SDK cannot store', async () => {
    const error = failure();
    rejectCall(error);
    respondRead(() => snapshot({ ...committed(), lastUpdated: { toMillis: () => NaN } } as never));
    await expect(save(payload)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { fromCache: true, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true },
  ])('rejects unconfirmed snapshot metadata %j', async metadata => {
    const error = failure();
    rejectCall(error);
    respondRead(() => snapshot(committed(), metadata));
    await expect(save(payload)).rejects.toBe(error);
  });

  it.each([{ dryRun: true }, { syncContract: {} }])(
    'does not recover non-committing or unidentified calls %j',
    async overrides => {
      const error = failure();
      rejectCall(error);
      await expect(save({ ...payload, ...overrides })).rejects.toBe(error);
      expect(readServer).not.toHaveBeenCalled();
    }
  );

  it('retains the original error when the read fails', async () => {
    const error = failure();
    rejectCall(error);
    respondRead(() => {
      throw new Error('Read unavailable');
    });
    await expect(save(payload)).rejects.toBe(error);
  });

  it('bounds readback and ignores a receipt arriving after the deadline', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    respondRead(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const error = failure();
    rejectCall(error);
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
