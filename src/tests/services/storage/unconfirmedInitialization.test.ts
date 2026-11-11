import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, clone, day, harnessState } from './specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import {
  copyPatientToDateDetailed,
  initializeDay,
  initializeDayDetailed,
} from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { ensureMonthIntegrity } from '@/services/repositories/monthIntegrity';
import { executeInitializeDailyRecord } from '@/application/daily-record/initializeDailyRecordUseCase';
import { executeSendCensusEmail } from '@/application/census-email/sendCensusEmailUseCases';
import * as sdk from 'firebase/firestore';

const DATE = '2026-11-01';
const PREVIOUS = '2026-10-31';
const previous = day(PREVIOUS, { R4: A() });
const remote = day(DATE, {}, '2026-11-01T10:00:00.000Z');
const event = vi.fn();
const unavailable = 'No se pudo confirmar el día con el servidor. Reintente con conexión.';

beforeEach(async () => {
  harnessState().offline = false;
  harnessState().remote = null;
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(clone(previous));
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  event.mockClear();
});
afterEach(async () => {
  window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  vi.restoreAllMocks();
});

const observeWrites = () => ({
  put: vi.spyOn(hospitalDB.dailyRecords, 'put'),
  bulkPut: vi.spyOn(hospitalDB.dailyRecords, 'bulkPut'),
});
const expectNoMutation = async (writes: ReturnType<typeof observeWrites>) => {
  expect(writes.put).not.toHaveBeenCalled();
  expect(writes.bulkPut).not.toHaveBeenCalled();
  expect(event).not.toHaveBeenCalled();
  expect(await hospitalDB.dailyRecords.get(DATE)).toBeUndefined();
  expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
  expect(await hospitalDB.syncQueue.count()).toBe(0);
};
const remoteDocument = (pending: boolean, confirmed = false) => {
  vi.mocked(sdk.getDoc).mockResolvedValue({
    exists: () => true,
    data: () => clone(remote),
    metadata: { fromCache: !confirmed && !pending, hasPendingWrites: pending },
  } as never);
};

it.each([
  { copy: false, pending: false },
  { copy: true, pending: false },
  { copy: false, pending: true },
  { copy: true, pending: true },
])(
  'rejects unconfirmed initialization: copy $copy, pending $pending',
  async ({ copy, pending }) => {
    remoteDocument(pending);
    const writes = observeWrites();
    await expect(initializeDayDetailed(DATE, copy ? PREVIOUS : undefined)).rejects.toThrow(
      unavailable
    );
    await expectNoMutation(writes);
  }
);

it('propagates unavailability through patient copy without saving the patient', async () => {
  remoteDocument(false);
  const writes = observeWrites();
  await expect(copyPatientToDateDetailed(PREVIOUS, 'R4', DATE, 'R4')).rejects.toThrow(unavailable);
  await expectNoMutation(writes);
});

it('reports the unavailable day as a month integrity error', async () => {
  remoteDocument(false);
  const writes = observeWrites();
  expect(await ensureMonthIntegrity(2026, 11, 1)).toEqual({
    success: false,
    errors: [DATE],
    initializedDays: [],
    totalDays: 1,
  });
  await expectNoMutation(writes);
});

it('returns initialization failure through the application error channel', async () => {
  remoteDocument(false);
  const writes = observeWrites();
  const result = await executeInitializeDailyRecord({ date: DATE, repository: { initializeDay } });
  expect(result.status).toBe('failed');
  expect(result.data.record).toBeNull();
  expect(result.issues[0].message).toBe(unavailable);
  await expectNoMutation(writes);
});

it('stops census email delivery when a missing monthly day cannot be confirmed', async () => {
  remoteDocument(false);
  const writes = observeWrites();
  const delivery = {
    sendEmailWithResult: vi.fn().mockResolvedValue({ status: 'success', issues: [] }),
    uploadBackupWithResult: vi.fn().mockResolvedValue({ status: 'success', issues: [] }),
  };
  const result = await executeSendCensusEmail(
    {
      record: remote,
      currentDateString: DATE,
      nurseSignature: 'Sintética',
      selectedYear: 2026,
      selectedMonth: 10,
      selectedDay: 1,
      recipients: ['synthetic@example.invalid'],
      message: '',
      role: 'admin',
      user: null,
      testModeEnabled: false,
      testRecipient: '',
      isAdminUser: true,
    },
    {
      dailyRecordReadPort: { initializeDay, getMonthRecords: async () => [] },
      censusEmailDeliveryPort: delivery as never,
    }
  );
  expect(result.status).toBe('failed');
  expect(result.issues[0].message).toContain(unavailable);
  expect(delivery.sendEmailWithResult).not.toHaveBeenCalled();
  expect(delivery.uploadBackupWithResult).not.toHaveBeenCalled();
  await expectNoMutation(writes);
});

it.each(['cached absence', 'network failure'])(
  'characterizes deferred creation after %s',
  async kind => {
    if (kind === 'network failure')
      vi.mocked(sdk.getDoc).mockRejectedValue(new Error('synthetic offline'));
    else
      vi.mocked(sdk.getDoc).mockResolvedValue({
        exists: () => false,
        metadata: { fromCache: true, hasPendingWrites: false },
      } as never);
    // Existing behavior, deliberately left for the separate verified-absence change.
    const result = await initializeDayDetailed(DATE);
    expect(result.record.date).toBe(DATE);
    expect(await hospitalDB.dailyRecords.get(DATE)).toBeDefined();
    expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
  }
);

it.each([false, true])('preserves confirmed document initialization: copy %s', async copy => {
  remoteDocument(false, true);
  expect((await initializeDayDetailed(DATE, copy ? PREVIOUS : undefined)).record.date).toBe(DATE);
  expect(await hospitalDB.dailyRecords.get(DATE)).toBeDefined();
  expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
});
it.each([false, true])('preserves confirmed absence creation: copy %s', async copy => {
  expect((await initializeDayDetailed(DATE, copy ? PREVIOUS : undefined)).record.date).toBe(DATE);
  expect(await hospitalDB.dailyRecords.get(DATE)).toBeDefined();
  expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
});
