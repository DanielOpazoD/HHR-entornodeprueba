vi.unmock('@/application/ports/dailyRecordPort');
import {
  prepareRecordExport,
  waitForExportReadiness,
} from '@/hooks/controllers/exportReadinessController';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  saveDetailed as actualSave,
  updatePartialDetailed as actualWrite,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import { processSyncQueue } from '@/services/storage/sync';
import { setDoc } from 'firebase/firestore';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { saveRecordStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';
import {
  resolvePatchOutcomeFeedback,
  presentSyncOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import {
  getDailyRecordQueryKey,
  setAuthoritativeDailyRecordRead,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
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
const patch = { 'beds.R1.pathology': 'DIAGNOSTICO SINTETICO C1' };
const key = pending.PENDING_DAILY_RECORD_PATCH_STORAGE_KEY;
let base = DataFactory.createMockDailyRecord(date);
let clients: QueryClient[] = [];
let persistCalls = 0;
let abortWrite = false;
let writeGate: Promise<void> | undefined;
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
  // El port delega sin simular al repositorio real; cuenta entradas a mutationFn.
  repository.updatePartialDetailed = async (...args) => {
    persistCalls++;
    await writeGate;
    return actualWrite(...args);
  };
  repository.saveDetailed = actualSave;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={createRepositoryContainer({ dailyRecord: repository })}>
        {children}
      </RepositoryProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
  return { ...hook, client, wrapper };
};
const value = (client: QueryClient) =>
  client.getQueryData<{ record: typeof base }>(getDailyRecordQueryKey(date))?.record.beds.R1
    .pathology;
const log = (name: string, data: unknown) =>
  process.stdout.write(`C1 ${name} ${JSON.stringify(data)}\n`);
beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
  vi.mocked(setDoc).mockClear();
  local.clear();
  session.clear();
  onlineManager.setOnline(true);
  persistCalls = 0;
  abortWrite = false;
  writeGate = undefined;
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
    expect(local.getItem(key)).toContain('DIAGNOSTICO');
    log('b-before-abort', { mirrorOnly: true });
    throw new DOMException('synthetic quota abort', 'QuotaExceededError');
  }
}
it('a: offline edit commits the row and authored task before reconnect', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(patch));
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  expect(h.result.current.isPaused).toBe(false);
  expect(persistCalls).toBe(1);
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    {
      status: 'PENDING',
      ownerKey: 'user:C1-A',
      payload: { beds: { R1: { pathology: patch['beds.R1.pathology'] } } },
    },
  ]);
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  onlineManager.setOnline(true);
  await h.client.resumePausedMutations();
  expect(persistCalls).toBe(1);
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  // Let the existing short remote-ack lease expire, as the reconnect worker does.
  const task = (await hospitalDB.syncQueue.toArray())[0];
  vi.spyOn(Date, 'now').mockReturnValue((task.nextAttemptAt ?? Date.now()) + 1);
  await processSyncQueue();
  await processSyncQueue();
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(vi.mocked(setDoc).mock.calls[0][1]).toMatchObject({
    beds: { R1: { pathology: patch['beds.R1.pathology'] } },
  });
  expect(await hospitalDB.syncQueue.count()).toBe(0);
});
it('b: actual transaction abort rolls back row/task; hook drops patch and error feedback exists', async () => {
  hospitalDB.syncQueue.hook('creating', abortHook);
  abortWrite = true;
  const h = setupHook();
  let payload: Awaited<ReturnType<typeof h.result.current.mutateAsync>>;
  await act(async () => {
    payload = await h.result.current.mutateAsync(patch);
  });
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('BASE');
  expect(local.getItem(key)).toBeNull();
  expect(value(h.client)).toBe('BASE');
  const feedback = resolvePatchOutcomeFeedback(payload!.result);
  const error = vi.fn();
  presentSyncOutcomeFeedback(feedback, 'Actualización', {
    error,
    warning: vi.fn(),
    success: vi.fn(),
  });
  expect(error).toHaveBeenCalledWith('Cambio no guardado', expect.any(String));
  expect(resolveDailyRecordSyncStatus([h.result.current])).toBe('error');
  let time = 0;
  const prepared = await prepareRecordExport({
    expectedDate: date,
    readRecord: () =>
      h.client.getQueryData<{ record: typeof base }>(getDailyRecordQueryKey(date))!.record,
    warning: vi.fn(),
    flushBeforeExport: () =>
      waitForExportReadiness({
        expectedDate: date,
        readState: () => ({
          selectedDate: date,
          recordDate: date,
          syncStatus: resolveDailyRecordSyncStatus([h.result.current]),
          hasSaveException: h.result.current.isError,
        }),
        now: () => time,
        wait: async ms => {
          time += ms;
        },
      }),
  });
  expect(prepared?.record?.beds.R1.pathology).toBe('BASE');
  expect(prepared?.canPrint()).toBe(true);
  log('b', {
    result: payload!.result,
    feedback,
    mutation: resolveDailyRecordSyncStatus([h.result.current]),
  });
});
it('d: six-minute mirror expiration keeps the durable edit', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(patch));
  await waitFor(() => expect(local.getItem(key)).toContain('DIAGNOSTICO'));
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 360000);
  expect(pending.applyPendingExplicitCensusPatch(date, base, base).beds.R1.pathology).toBe('BASE');
  expect(local.getItem(key)).toBeNull();
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  log('d-expired', {
    overlay: 'BASE',
    cached: value(h.client),
    tasks: await hospitalDB.syncQueue.count(),
  });
  onlineManager.setOnline(true);
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  log('d-reconnected', {
    tasks: await hospitalDB.syncQueue.count(),
    pathology: (await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology,
  });
});
/** What the next person in the same tab sees once the server publishes the census day. */
const nextPersonSees = () => {
  const client = new QueryClient();
  clients.push(client);
  setDailyRecordQueryData(client, date, base);
  setAuthoritativeDailyRecordRead(client, date, base);
  return value(client);
};
it('e: logout keeps the durable edit with its owner; the next person never sees its overlay', async () => {
  const h = setupHook();
  await act(async () => {
    await h.result.current.mutateAsync(patch);
  });
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  await clearSessionScopedClientState('manual');
  expect(local.getItem(key)).toBeNull();
  await reconcileAuthorizedSessionOwner('user:C1-B');
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks[0]).toMatchObject({
    ownerKey: 'user:C1-A',
    status: 'FAILED',
    projectionReleased: true,
    payload: { beds: { R1: { pathology: patch['beds.R1.pathology'] } } },
  });
  expect(await hospitalDB.dailyRecords.count()).toBe(0);
  expect(await createDexieSyncQueueStore().listAll('user:C1-B')).toEqual([]);
  expect(nextPersonSees()).toBe('BASE');
  expect(pending.applyPendingExplicitCensusPatch(date, base, base).beds.R1.pathology).toBe('BASE');
  expect(local.getItem(key)).toBeNull();
});
it('e: the same person signing in again keeps the unsent task, not the previous overlay', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(patch));
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-A');
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    {
      ownerKey: 'user:C1-A',
      payload: { beds: { R1: { pathology: patch['beds.R1.pathology'] } } },
    },
  ]);
  expect(nextPersonSees()).toBe('BASE');
});
it('e: an edit still on its way to the outbox at logout keeps its fate; only its overlay is forgotten', async () => {
  writeGate = new Promise<void>(resolve => {
    releaseWrite = resolve;
  });
  const h = setupHook();
  act(() => {
    inFlight = h.result.current.mutateAsync(patch).catch(error => error);
  });
  await waitFor(() => expect(local.getItem(key)).toContain('DIAGNOSTICO'));
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  expect(nextPersonSees()).toBe('BASE');
  releaseWrite?.();
  await inFlight;
  // Forgetting the overlay does not touch the write: the edit still reaches the outbox.
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { payload: { beds: { R1: { pathology: patch['beds.R1.pathology'] } } } },
  ]);
  log('e-in-flight-dexie', {
    tasks: (await hospitalDB.syncQueue.toArray()).map(({ ownerKey, status }) => ({
      ownerKey,
      status,
    })),
    row: (await hospitalDB.dailyRecords.get(date))?.beds.R1?.pathology ?? null,
  });
  expect(nextPersonSees()).toBe('BASE');
});
it('f: independent module reads the mirror; Dexie admission preserves the durable edit', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(patch));
  await waitFor(() => expect(local.getItem(key)).toContain('DIAGNOSTICO'));
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  vi.resetModules();
  const tabB = await import('@/hooks/controllers/dailyRecordPendingPatchController');
  expect(tabB.applyPendingExplicitCensusPatch(date, base, base).beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  onlineManager.setOnline(true);
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  const admission = await saveRecordStrict(base, { preserveUnresolvedWrites: true });
  expect(admission.ok).toBe(true);
  expect(admission.retainedRecord?.beds.R1.pathology).toBe(patch['beds.R1.pathology']);
  log('f', {
    sharedMirrorProtection: 'shared localStorage overlay',
    afterCommitProtection: 'Dexie retainedRecord',
    retained: admission.retainedRecord?.beds.R1.pathology,
  });
});

it('g-control: complete repository path commits offline without a remote acknowledgement', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(patch));
  await waitFor(() => expect(local.getItem(key)).toContain('DIAGNOSTICO'));
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  expect(h.result.current.isPaused).toBe(false);
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  onlineManager.setOnline(true);
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  expect(resolveDailyRecordSyncStatus([h.result.current])).toBe('local');
  log('g-real-repository', {
    tasks: await hospitalDB.syncQueue.count(),
    state: h.result.current.data?.result,
  });
});

it('full save reaches the existing durable outbox offline', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  const save = renderHook(() => useSaveDailyRecordMutation(), { wrapper: h.wrapper });
  const record = { ...base, nursesDayShift: ['SYNTHETIC NURSE'] };
  act(() => save.result.current.mutate({ record, baseRecord: base }));
  await waitFor(() => expect(save.result.current.isSuccess).toBe(true));
  expect((await hospitalDB.dailyRecords.get(date))?.nursesDayShift).toEqual(['SYNTHETIC NURSE']);
  expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
    { status: 'PENDING', ownerKey: 'user:C1-A' },
  ]);
});
it.each([
  { partial: patch, options: { requireRemoteAuthorityFirst: true } },
  { partial: { 'beds.R1.medicalHandoffEntries': [] } },
])('remote-authority patch remains paused without a local task: %j', async input => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(input));
  await waitFor(() => expect(h.result.current.isPaused).toBe(true));
  expect(persistCalls).toBe(0);
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('BASE');
  expect(local.getItem(key)).toBeNull();
  onlineManager.setOnline(true);
  await h.client.resumePausedMutations();
});
it('remote-first full save stays paused offline', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  const save = renderHook(() => useSaveDailyRecordMutation(), { wrapper: h.wrapper });
  act(() => save.result.current.mutate({ record: base, rayenStructuralWriteGuard: true }));
  await waitFor(() => expect(save.result.current.isPaused).toBe(true));
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  onlineManager.setOnline(true);
  await h.client.resumePausedMutations();
});
it('c: reload with fresh modules recovers the durable row and task', async () => {
  onlineManager.setOnline(false);
  const h = setupHook();
  act(() => h.result.current.mutate(patch));
  await waitFor(() => expect(local.getItem(key)).toContain('DIAGNOSTICO'));
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  h.unmount();
  const freshModule = await vi.importActual<typeof pending>(
    '@/hooks/controllers/dailyRecordPendingPatchController'
  );
  const stored = (await hospitalDB.dailyRecords.get(date))!;
  expect(
    freshModule.applyPendingExplicitCensusPatch(date, stored, undefined).beds.R1.pathology
  ).toBe(patch['beds.R1.pathology']);
  expect(freshModule.applyPendingExplicitCensusPatch(date, stored, stored).beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  expect(await hospitalDB.syncQueue.count()).toBe(1);
  // Discard module memory really, retaining jsdom storage and fake IndexedDB, as a reload.
  vi.resetModules();
  const reloaded = await import('@/hooks/controllers/dailyRecordPendingPatchController');
  const { hospitalDB: reopened } = await import('@/services/storage/indexeddb/indexedDbCore');
  expect((await reopened.dailyRecords.get(date))?.beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  expect(await reopened.syncQueue.toArray()).toMatchObject([
    { status: 'PENDING', ownerKey: 'user:C1-A' },
  ]);
  reopened.close();
  expect(reloaded.applyPendingExplicitCensusPatch(date, stored, stored).beds.R1.pathology).toBe(
    patch['beds.R1.pathology']
  );
  log('c', {
    dexie: stored.beds.R1.pathology,
    initialWithoutPrevious: stored.beds.R1.pathology,
    mirrorCanOverlayWithPrevious: true,
    tasks: await hospitalDB.syncQueue.count(),
  });
  onlineManager.setOnline(true);
  await h.client.resumePausedMutations();
});
