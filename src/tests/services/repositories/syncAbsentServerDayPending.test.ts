import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { A, clone, day, harnessState } from '@/tests/services/storage/dayRecordOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { executeSyncDailyRecord } from '@/application/daily-record/syncDailyRecordUseCase';
import { fetchRemoteDailyRecordQuery } from '@/hooks/controllers/dailyRecordQueryController';
import { presentDailyRecordRefreshOutcome } from '@/hooks/controllers/dailyRecordRefreshOutcomeController';

// «Sincronizar» on a day the server does not have, with this computer's copy (SAVE-01).
const DATE = '2026-10-24';
const h = harnessState();
let client: QueryClient;

const refresh = () =>
  executeSyncDailyRecord({
    date: DATE,
    read: date => fetchRemoteDailyRecordQuery(client, { getForDateWithMeta }, date),
  });

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-absent-day');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.dailyRecords.put(day(DATE, { R4: A() }));
  h.remote = null;
  h.offline = false;
  h.writeFence = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  client.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
});

it('is pending, never confirmed nor alarming, while a queued note waits to create the day', async () => {
  h.offline = true;
  const base = clone((await hospitalDB.dailyRecords.get(DATE))!);
  await updatePartialDetailed(
    DATE,
    { handoffNovedadesNightShift: 'Nota pendiente sintética' },
    { authoringSession: captureAuthoringSession(), baseRecord: base }
  );
  h.offline = false;
  expect(await hospitalDB.syncQueue.count()).toBe(1);

  const outcome = await refresh();

  expect(outcome.status).toBe('partial');
  expect(outcome.data.degradationReason).toBe('pending_local_write');
  expect(outcome.data.record?.handoffNovedadesNightShift).toBe('Nota pendiente sintética');
  expect(presentDailyRecordRefreshOutcome(outcome).channel).toBeNull();
  expect(await hospitalDB.syncQueue.count()).toBe(1);
});

it('says the remote record is not available when nothing will publish the local copy', async () => {
  const outcome = await refresh();

  expect(outcome.status).toBe('partial');
  expect(outcome.data.degradationReason).toBe('missing_remote_record');
  expect(presentDailyRecordRefreshOutcome(outcome).title).toBe('Registro remoto no disponible');
  expect(await hospitalDB.dailyRecords.get(DATE)).toBeDefined();
});
