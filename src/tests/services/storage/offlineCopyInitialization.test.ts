import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, clone, day, harnessState } from './specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { copyPatientToDateDetailed } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { executeMoveOrCopyController } from '@/features/census/controllers/censusActionRuntimeController';
import * as sdk from 'firebase/firestore';

const PREVIOUS = '2026-10-31';
const DATE = '2026-11-01';
const previous = day(PREVIOUS, { R4: A() });
const online = navigator.onLine;
beforeEach(async () => {
  harnessState().offline = false; // Firestore remains enabled; only network connectivity is lost.
  harnessState().remote = day(DATE, { R4: A() });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(clone(previous));
  vi.mocked(sdk.getDoc).mockRejectedValue(new Error('synthetic offline'));
  vi.mocked(sdk.getDocFromServer).mockRejectedValue(new Error('synthetic offline'));
  vi.mocked(sdk.runTransaction).mockRejectedValue(new Error('synthetic offline'));
});
afterEach(async () => {
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  vi.restoreAllMocks();
});
it('STOP: normal copy-to-tomorrow action creates a missing day while offline', async () => {
  const result = await executeMoveOrCopyController({
    actionState: { type: 'copy', sourceBedId: 'R4', targetBedId: 'R5' },
    record: previous,
    targetDate: DATE,
    actions: {
      copyPatientToDate: (source, date, target) =>
        copyPatientToDateDetailed(PREVIOUS, source, date, target || source).then(() => undefined),
      moveOrCopyPatient: vi.fn(),
    },
  });
  console.log(
    JSON.stringify({
      flow: 'copy-to-tomorrow',
      ok: result.ok,
      tasks: await hospitalDB.syncQueue.count(),
    })
  );
  expect(result.ok).toBe(true);
  expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R5.patientName).toBe(
    previous.beds.R4.patientName
  );
  expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
  expect(await hospitalDB.syncQueue.count()).toBeGreaterThan(0);
});
it('preserves copying to tomorrow when the day is already local offline', async () => {
  await hospitalDB.dailyRecords.put(day(DATE, {}));
  vi.mocked(sdk.getDoc).mockClear();
  await copyPatientToDateDetailed(PREVIOUS, 'R4', DATE, 'R5');
  expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R5.patientName).toBe(
    previous.beds.R4.patientName
  );
  expect(await hospitalDB.dailyRecords.get(PREVIOUS)).toEqual(previous);
  // Main performs best-effort remote reads even with a local base; the copy still completes.
});
