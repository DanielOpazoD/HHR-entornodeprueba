import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { harnessState, reconnect } from '@/tests/services/storage/specialistHandoffOutboxHarness';
import {
  queue,
  remote,
  resetNoteDay,
  DATE,
} from '@/tests/services/storage/specialistHandoffNoteDaySupport';
import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import * as routing from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

vi.mock('@/services/repositories/dailyRecordRepositoryReadService', async importOriginal => ({
  ...(await importOriginal<object>()),
  getForDate: vi.fn(async () => null),
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', async importOriginal => ({
  ...(await importOriginal<object>()),
  loadRemoteRecordWithFallback: vi.fn(async () => ({ record: null })),
}));
const h = harnessState();
const stamp = DATE + 'T10:00:00.000Z';
let race = false;
beforeEach(async () => {
  await resetNoteDay('user:synthetic-day-creation');
  h.remote = null;
  h.authorityMode = true;
  race = false;
  vi.spyOn(routing, 'shouldRouteDailyRecordSaveViaCallable').mockResolvedValue(true);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(stamp) });
  vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
    async payload => {
      // This other tab wins after our last missing-day read. Its commit has the same millisecond
      // as the local clock used to build this tab's new day: that coincidence is not a read base.
      if (race && !h.remote)
        h.remote = {
          ...buildInitializedDayRecord(DATE, null),
          nursesDayShift: ['ENFERMERIA SINTETICA A'],
          meta: { revision: 1 },
        } as never;
      const { admin } = createAdminMock({
        remoteData: h.remote ? JSON.parse(JSON.stringify(h.remote)) : undefined,
      });
      try {
        const response = await createDailyRecordWriteAuthorityFunctions({
          firestore: admin.firestore(),
          Timestamp: { now: () => new Date(stamp) },
          resolveRoleForEmail: async () => 'admin',
        }).saveDailyRecordWithClinicalAuthority.run(payload, makeContext());
        h.remote = JSON.parse(JSON.stringify(response.recordState.record));
        return response;
      } catch (error) {
        throw authority.normalizeDailyRecordAuthorityError(error);
      }
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('retains a refused creation when another tab creates the day at the same millisecond', async () => {
  race = true;
  await initializeDay(DATE);
  expect(remote().nursesDayShift).toEqual(['ENFERMERIA SINTETICA A']);
  const tasks = await queue();
  expect(tasks).toHaveLength(1);
  expect(tasks[0].syncContract?.expectedVersion).toBe('');
  expect(tasks[0].payload).toMatchObject({ date: DATE });
  expect(
    (tasks[0].payload as { nursesDayShift: string[] }).nursesDayShift.every(value => !value)
  ).toBe(true);
  await reconnect();
  expect(remote().nursesDayShift).toEqual(['ENFERMERIA SINTETICA A']);
  expect(await queue()).toMatchObject([
    { id: tasks[0].id, status: 'FAILED', payload: tasks[0].payload },
  ]);
});
it('creates a genuinely absent day with no invented remote base', async () => {
  await expect(initializeDay(DATE)).resolves.toMatchObject({ date: DATE });
  expect(remote().date).toBe(DATE);
  expect((remote() as unknown as { meta: { revision: number } }).meta.revision).toBe(1);
  expect(await queue()).toHaveLength(0);
});
