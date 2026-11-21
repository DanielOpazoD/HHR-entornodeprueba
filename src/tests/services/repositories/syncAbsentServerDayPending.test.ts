import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  A,
  clone,
  day,
  harnessState,
  reconnect,
} from '@/tests/services/storage/dayRecordOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { executeSyncDailyRecord } from '@/application/daily-record/syncDailyRecordUseCase';
import { fetchRemoteDailyRecordQuery } from '@/hooks/controllers/dailyRecordQueryController';
import { presentDailyRecordRefreshOutcome } from '@/hooks/controllers/dailyRecordRefreshOutcomeController';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// «Sincronizar» on a day the server confirms it does not have, with this computer's copy: the same
// answer as main whatever waits in the queue, and the copy and the queue untouched (SAVE-01).
const DATE = '2026-10-24';
const NOTE = 'Diagnóstico pendiente sintético';
const h = harnessState();
let client: QueryClient;

const refresh = () =>
  executeSyncDailyRecord({
    date: DATE,
    read: date => fetchRemoteDailyRecordQuery(client, { getForDateWithMeta }, date),
  });

const queueNote = async () => {
  h.offline = true;
  const base = clone((await hospitalDB.dailyRecords.get(DATE))!);
  await updatePartialDetailed(
    DATE,
    { 'beds.R4.pathology': NOTE },
    { authoringSession: captureAuthoringSession(), baseRecord: base }
  );
  h.offline = false;
};

const queue = async () =>
  (await hospitalDB.syncQueue.toArray()).map(task => ({
    status: task.status,
    note: (task.payload as DailyRecord).beds.R4.pathology,
  }));

const expectMainAnswer = async () => {
  const outcome = await refresh();
  expect(outcome.status).toBe('partial');
  expect(outcome.data.degradationReason).toBe('missing_remote_record');
  expect(presentDailyRecordRefreshOutcome(outcome)).toMatchObject({
    channel: 'warning',
    title: 'Registro remoto no disponible',
  });
  return outcome;
};

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-absent-day');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.dailyRecords.put(day(DATE, { R4: A() }));
  h.remote = null;
  h.offline = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  client.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
});

it('answers as main with a pending edit, keeps it, and the queue publishes it on replay', async () => {
  await queueNote();

  const outcome = await expectMainAnswer();

  expect(outcome.data.record?.beds.R4.pathology).toBe(NOTE);
  expect(await queue()).toEqual([{ status: 'PENDING', note: NOTE }]);
  expect(h.remote).toBeNull();

  await reconnect();

  expect(h.remote?.beds.R4.pathology).toBe(NOTE);
  expect(await queue()).toEqual([]);
});

it('answers as main with an edit held in conflict, and keeps the edit and the task', async () => {
  await queueNote();
  await hospitalDB.syncQueue.toCollection().modify({ status: 'CONFLICT' });

  const outcome = await expectMainAnswer();

  expect(outcome.data.record?.beds.R4.pathology).toBe(NOTE);
  expect(await queue()).toEqual([{ status: 'CONFLICT', note: NOTE }]);
  expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R4.pathology).toBe(NOTE);
});

it('answers as main when nothing waits in the queue, and keeps the local copy', async () => {
  await expectMainAnswer();

  expect(await hospitalDB.dailyRecords.get(DATE)).toBeDefined();
  expect(await queue()).toEqual([]);
});
