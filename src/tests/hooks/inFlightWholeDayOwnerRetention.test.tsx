import { authoredOptions } from '@/services/storage/authoringSession';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { sessionClosedTaskState } from '@/services/storage/sync/syncQueueTaskFactory';
import { processSyncQueue } from '@/services/storage/sync';
import { useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import { getDailyRecordWriteState } from '@/services/repositories/dailyRecordWriteCoordinator';

import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
const notices = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('@/context/UIContext', () => ({ useNotification: () => notices }));
vi.mock('@/context/VersionContext', () => ({ useVersion: () => ({ checkVersion: vi.fn() }) }));
vi.unmock('@/application/ports/dailyRecordPort');
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { saveDetailed as actualSave } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { setDoc } from 'firebase/firestore';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import * as pending from '@/hooks/controllers/dailyRecordPendingPatchController';

vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { getCurrentUser: () => ({ uid: 'C1-A' }) },
}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const { createSingleAttemptFirestoreMock } =
    await import('@/tests/services/storage/singleAttemptFirestoreTransactionMock');
  return { ...actual, ...createSingleAttemptFirestoreMock() };
});
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>();
  return {
    ...actual,
    getRecordDocRef: vi.fn(() => ({ id: 'synthetic-doc' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => false,
  getFirestoreSyncState: () => ({ mode: 'disabled', reason: 'offline' }),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
const date = '2026-11-11';
let base = DataFactory.createMockDailyRecord(date);
let clients: QueryClient[] = [];
let abortWrite = false;
let releaseWrite: (() => void) | undefined;
let inFlight: Promise<unknown> | undefined;
// Use native Storage from a fresh window, rather than the setup's mocked globals.
const storageFrame = document.createElement('iframe');
document.body.append(storageFrame);
const local = storageFrame.contentWindow!.localStorage;
const session = storageFrame.contentWindow!.sessionStorage;
afterAll(() => storageFrame.remove());
const setupHook = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  setDailyRecordQueryData(client, date, base);
  const repository = buildMockDailyRecordRepository();
  repository.saveDetailed = (first, second, options) =>
    actualSave(first, second, authoredOptions(options ?? {}));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={createRepositoryContainer({ dailyRecord: repository })}>
        {children}
      </RepositoryProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
};

beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
  vi.mocked(setDoc).mockClear();
  local.clear();
  session.clear();
  onlineManager.setOnline(true);
  abortWrite = false;
  resetDailyRecordFreshnessGateForTests();
  pending.clearPendingDailyRecordPatchesForTests();
  setSessionGeneration('C1-generation');
  local.setItem(SESSION_OWNER_KEY, 'user:C1-A');
  local.setItem(SESSION_GENERATION_KEY, 'C1-generation');
  await hospitalDB.open();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  base = DataFactory.createMockDailyRecord(date);
  base.beds.R1 = {
    ...base.beds.R1,
    clinicalEpisodeId: 'ep_synthetic_C1',
    patientName: 'PACIENTE SINTETICO C1',
    pathology: 'BASE',
  };
  base.beds = { R1: base.beds.R1 };
  await hospitalDB.dailyRecords.put(base);
});
afterEach(async () => {
  // A failed assertion must not leave a held write owning the date's mutation turn.
  releaseWrite?.();
  await inFlight;
  releaseWrite = undefined;
  inFlight = undefined;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.unstubAllEnvs();
  cleanup();
  clients.forEach(client => client.clear());
  clients = [];
  hospitalDB.syncQueue.hook('creating').unsubscribe(abortHook);
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  pending.clearPendingDailyRecordPatchesForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
});
function abortHook() {
  if (abortWrite) {
    throw new DOMException('synthetic quota abort', 'QuotaExceededError');
  }
}

it.each([0, 192])('full save retains A across the lock with %i B tasks', async count => {
  const h = setupHook();
  const save = renderHook(() => useDailyRecordSyncQuery(date), { wrapper: h.wrapper });
  const lock = runExclusiveDailyRecordWrite(
    date,
    () =>
      new Promise<void>(r => {
        releaseWrite = r;
      })
  );
  await waitFor(() => expect(releaseWrite).toBeDefined());
  act(() => {
    inFlight = save.result.current
      .saveAndUpdate({ ...base, nursesDayShift: ['SYNTHETIC A'] }, base)
      .catch(e => e);
  });
  await waitFor(() => expect(getDailyRecordWriteState(date).pendingCount).toBe(2));
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  const bRecord = { ...base, nursesDayShift: ['SYNTHETIC B'] };
  await hospitalDB.dailyRecords.put(bRecord);
  setDailyRecordQueryData(h.client, date, bRecord);
  await hospitalDB.syncQueue.bulkAdd(
    Array.from({ length: count }, (_, i) => ({
      opId: 'synthetic-B-' + i,
      ownerKey: 'user:C1-B',
      type: 'UPDATE_DAILY_RECORD' as const,
      key: 'synthetic:' + i,
      payload: base,
      timestamp: i,
      retryCount: 0,
      status: 'PENDING' as const,
    }))
  );
  const before = await createDexieSyncQueueStore().listAll('user:C1-B');
  Object.values(notices).forEach(n => n.mockClear());
  releaseWrite?.();
  await lock;
  await inFlight;
  expect(await createDexieSyncQueueStore().listAll('user:C1-B')).toEqual(before);
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(bRecord);
  expect(
    h.client.getQueryData<{ record: typeof base }>(getDailyRecordQueryKey(date))?.record
  ).toEqual(bRecord);
  const owned = await createDexieSyncQueueStore().listAll('user:C1-A');
  expect(owned).toMatchObject([
    {
      ownerKey: 'user:C1-A',
      status: 'FAILED',
      projectionReleased: true,
      lastErrorCode: 'session_owner_logged_out',
      payload: { nursesDayShift: ['SYNTHETIC A'] },
    },
  ]);
  Object.values(notices).forEach(n => expect(n).not.toHaveBeenCalled());
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-A');
  expect(await createDexieSyncQueueStore().listAll('user:C1-A')).toEqual(owned);
  expect(setDoc).not.toHaveBeenCalled();
});
it('unchanged session queues the complete save offline', async () => {
  const h = setupHook();
  const save = renderHook(() => useSaveDailyRecordMutation(), { wrapper: h.wrapper });
  await act(async () => {
    await save.result.current.mutateAsync({
      authoringSession: captureAuthoringSession(),
      record: { ...base, nursesDayShift: ['SYNTHETIC A'] },
      baseRecord: base,
    });
  });
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { ownerKey: 'user:C1-A', status: 'PENDING', payload: { nursesDayShift: ['SYNTHETIC A'] } },
  ]);
  expect((await hospitalDB.dailyRecords.get(date))?.nursesDayShift).toEqual(['SYNTHETIC A']);
});

it('direct full save captures before waiting for the repository lock', async () => {
  const lock = runExclusiveDailyRecordWrite(
    date,
    () =>
      new Promise<void>(r => {
        releaseWrite = r;
      })
  );
  await waitFor(() => expect(releaseWrite).toBeDefined());
  inFlight = actualSave({ ...base, nursesDayShift: ['SYNTHETIC A'] }, undefined, {
    authoringSession: captureAuthoringSession(),
    baseRecord: base,
  });
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  await hospitalDB.dailyRecords.put(base);
  releaseWrite?.();
  await lock;
  await inFlight;
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { ownerKey: 'user:C1-A', status: 'FAILED' },
  ]);
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});
it('retention preserves the complete task and its base, and reentry never sends it', async () => {
  await actualSave({ ...base, nursesDayShift: ['SYNTHETIC A'] }, undefined, {
    authoringSession: captureAuthoringSession(),
    baseRecord: base,
  });
  const before = (await hospitalDB.syncQueue.toArray())[0];
  const author = captureAuthoringSession();
  const { id: _id, ...raw } = before;
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  await hospitalDB.dailyRecords.put(base);
  await createDexieSyncQueueStore().saveDailyRecordWithTask(
    before.payload as typeof base,
    raw,
    undefined,
    base,
    author
  );
  const retained = (await hospitalDB.syncQueue.toArray()).find(t => t.id !== before.id)!;
  expect(retained).toEqual({
    ...before,
    ...sessionClosedTaskState(),
    projectionReleased: true,
    id: retained.id,
  });
  expect(retained.id).toBeGreaterThan(before.id!);
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-A');
  const backups = await hospitalDB.syncQueue.toArray();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await processSyncQueue();
  expect(await hospitalDB.syncQueue.toArray()).toEqual(backups);
  expect(setDoc).not.toHaveBeenCalled();
});
it('same session still sees a real IndexedDB failure', async () => {
  const h = setupHook();
  const save = renderHook(() => useDailyRecordSyncQuery(date), { wrapper: h.wrapper });
  Object.values(notices).forEach(n => n.mockClear());
  hospitalDB.syncQueue.hook('creating', abortHook);
  abortWrite = true;
  await act(async () => {
    await save.result.current
      .saveAndUpdate({ ...base, nursesDayShift: ['SYNTHETIC A'] }, base)
      .catch(() => undefined);
  });
  expect(notices.error).toHaveBeenCalledWith('Guardado no confirmado', expect.any(String));
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});

it('the lazy production port keeps the author before loading the repository', async () => {
  const write = defaultDailyRecordRepositoryPort.saveDetailed(
    { ...base, nursesDayShift: ['SYNTHETIC A'] },
    undefined,
    { authoringSession: captureAuthoringSession(), baseRecord: base }
  );
  local.setItem(SESSION_OWNER_KEY, 'user:C1-B');
  setSessionGeneration('synthetic-B');
  await hospitalDB.dailyRecords.put(base);
  await write;
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { ownerKey: 'user:C1-A', status: 'FAILED' },
  ]);
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});
