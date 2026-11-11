import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, clone, day, harnessState } from './specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { ensureMonthIntegrity } from '@/services/repositories/monthIntegrity';
import { executeSendCensusEmail } from '@/application/census-email/sendCensusEmailUseCases';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
vi.unmock('@/application/ports/dailyRecordPort');

import * as sdk from 'firebase/firestore';

const DATE = '2026-11-01';
const PREVIOUS = '2026-10-31';
const previous = day(PREVIOUS, { R4: A() });
const current = day(DATE, {});
const delivery = {
  sendEmail: vi.fn(),
  uploadBackup: vi.fn(),
  sendEmailWithResult: vi.fn().mockResolvedValue({ status: 'success', issues: [] }),
  uploadBackupWithResult: vi.fn().mockResolvedValue({ status: 'success', issues: [] }),
};
const send = () =>
  executeSendCensusEmail(
    {
      record: current,
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
      dailyRecordReadPort: {
        ...defaultDailyRecordReadPort,
        getMonthRecords: () =>
          hospitalDB.dailyRecords.where('date').startsWith('2026-11').toArray(),
      },
      censusEmailDeliveryPort: delivery,
    }
  );
beforeEach(async () => {
  harnessState().offline = false;
  harnessState().remote = null;
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(clone(previous));
  vi.clearAllMocks();
});
afterEach(async () => {
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  vi.restoreAllMocks();
});
const failLookup = (kind: string) => {
  harnessState().remote = day(DATE, { R4: A() });
  if (kind === 'failed lookup') {
    vi.mocked(sdk.getDoc).mockRejectedValue(new Error('synthetic offline'));
    vi.mocked(sdk.getDocFromServer).mockRejectedValue(new Error('synthetic offline'));
  } else {
    vi.mocked(sdk.getDoc).mockResolvedValue({
      exists: () => false,
      metadata: { fromCache: true, hasPendingWrites: false },
    } as never);
  }
  vi.mocked(sdk.runTransaction).mockRejectedValue(new Error('synthetic offline'));
};
const noCreation = async () => {
  expect(await hospitalDB.dailyRecords.get(DATE)).toBeUndefined();
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
};
it.each(['failed lookup', 'cached absence'])(
  'email stops without creating a day: %s, then retries',
  async kind => {
    failLookup(kind);
    const result = await send();
    console.log(
      JSON.stringify({
        flow: 'email',
        kind,
        status: result.status,
        newRows: (await hospitalDB.dailyRecords.get(DATE)) ? 1 : 0,
        tasks: await hospitalDB.syncQueue.count(),
        sends: delivery.sendEmailWithResult.mock.calls.length,
      })
    );
    expect(result.status).toBe('failed');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(delivery.sendEmailWithResult).not.toHaveBeenCalled();
    expect(delivery.uploadBackupWithResult).not.toHaveBeenCalled();
    await noCreation();
    vi.mocked(sdk.getDoc).mockResolvedValue({
      exists: () => false,
      metadata: { fromCache: false, hasPendingWrites: false },
    } as never);
    harnessState().remote = null;
    expect((await send()).status).toBe('success');
    expect(delivery.sendEmailWithResult).toHaveBeenCalledTimes(1);
  }
);
it.each(['failed lookup', 'cached absence'])(
  'month reports error without creating a day: %s, then retries',
  async kind => {
    failLookup(kind);
    const result = await ensureMonthIntegrity(2026, 11, 1);
    console.log(
      JSON.stringify({
        flow: 'month',
        kind,
        ...result,
        newRows: (await hospitalDB.dailyRecords.get(DATE)) ? 1 : 0,
        tasks: await hospitalDB.syncQueue.count(),
      })
    );
    expect(result).toEqual({ success: false, errors: [DATE], initializedDays: [], totalDays: 1 });
    await noCreation();
    vi.mocked(sdk.getDoc).mockResolvedValue({
      exists: () => false,
      metadata: { fromCache: false, hasPendingWrites: false },
    } as never);
    harnessState().remote = null;
    expect(await ensureMonthIntegrity(2026, 11, 1)).toEqual({
      success: true,
      errors: [],
      initializedDays: [DATE],
      totalDays: 1,
    });
  }
);
it('preserves confirmed absence initialization from the main screen', async () => {
  expect((await initializeDay(DATE)).date).toBe(DATE);
  expect(await hospitalDB.dailyRecords.get(DATE)).toBeDefined();
});
it('preserves confirmed absence in email and month', async () => {
  expect((await send()).status).toBe('success');
  expect(delivery.sendEmailWithResult).toHaveBeenCalledTimes(1);
  expect((await ensureMonthIntegrity(2026, 11, 1)).success).toBe(true);
});
