import { applyPatches } from '@/utils/patchUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { sessionClosedTaskState } from '@/services/storage/sync/syncQueueTaskFactory';
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
import {
  saveDetailed as actualSave,
  updatePartialDetailed as actualWrite,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { setDoc } from 'firebase/firestore';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import {
  resolvePatchOutcomeFeedback,
  presentSyncOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import {
  getDailyRecordQueryKey,
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
const holdEditAcrossSessionChange = async (nextOwner: string) => {
  writeGate = new Promise<void>(resolve => {
    releaseWrite = resolve;
  });
  const h = setupHook();
  act(() => {
    inFlight = h.result.current.mutateAsync(patch).catch(error => error);
  });
  await waitFor(() => expect(local.getItem(key)).toContain('DIAGNOSTICO'));
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner(nextOwner);
  return h;
};
const retainedForA = {
  ownerKey: 'user:C1-A',
  status: 'FAILED',
  projectionReleased: true,
  lastErrorCode: 'session_owner_logged_out',
  payload: { beds: { R1: { pathology: patch['beds.R1.pathology'] } } },
};
it('review: notification after B enters', async () => {
  await holdEditAcrossSessionChange('user:C1-B');
  releaseWrite?.();
  const payload = (await inFlight) as { result: Awaited<ReturnType<typeof actualWrite>> };
  const error = vi.fn();
  presentSyncOutcomeFeedback(resolvePatchOutcomeFeedback(payload.result), 'Actualización', {
    error,
    warning: vi.fn(),
    success: vi.fn(),
  });
  log('review-notification', { owner: local.getItem(SESSION_OWNER_KEY), calls: error.mock.calls });
  expect(error).not.toHaveBeenCalled();
});

it('review: actual UI callback notifies B about A', async () => {
  notices.error.mockClear();
  notices.warning.mockClear();
  notices.success.mockClear();
  writeGate = new Promise<void>(resolve => {
    releaseWrite = resolve;
  });
  const setup = setupHook();
  const h = renderHook(() => useDailyRecordSyncQuery(date), { wrapper: setup.wrapper });
  act(() => {
    inFlight = h.result.current.patchRecord(patch).catch((e: unknown) => e);
  });
  await waitFor(() => expect(persistCalls).toBe(1));
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  releaseWrite?.();
  await inFlight;
  log('review-real-ui', {
    owner: local.getItem(SESSION_OWNER_KEY),
    calls: notices.error.mock.calls,
  });
  expect(notices.error).not.toHaveBeenCalled();
  expect(notices.warning).not.toHaveBeenCalled();
  expect(notices.success).not.toHaveBeenCalled();
  expect(value(setup.client)).not.toBe(patch['beds.R1.pathology']);
});

it('direct repository patch retains its author while waiting for the lock', async () => {
  let unlock!: () => void;
  const gate = new Promise<void>(r => (unlock = r));
  const lock = runExclusiveDailyRecordWrite(date, () => gate);
  const write = actualWrite(date, patch, { baseRecord: base });
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  await hospitalDB.dailyRecords.put(base);
  unlock();
  await lock;
  await write;
  const tasks = await hospitalDB.syncQueue.toArray();
  log('review-direct-partial', { tasks, row: await hospitalDB.dailyRecords.get(date) });
  expect(tasks[0].ownerKey).toBe('user:C1-A');
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});
it.each(['user:C1-B', 'user:C1-A'])(
  'a full active queue for %s cannot discard the previous session edit',
  async nextOwner => {
    await holdEditAcrossSessionChange(nextOwner);
    await hospitalDB.syncQueue.bulkAdd(
      Array.from({ length: 192 }, (_, i) => ({
        opId: 'synthetic-B-' + i,
        ownerKey: nextOwner,
        type: 'UPDATE_DAILY_RECORD' as const,
        key: 'daily:' + new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
        payload: { ...base, date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10) },
        timestamp: i,
        retryCount: 0,
        status: 'PENDING' as const,
      }))
    );
    releaseWrite?.();
    await inFlight;
    const owned = (await createDexieSyncQueueStore().listAll('user:C1-A')).filter(
      task => task.status === 'FAILED'
    );
    log('review-budget', {
      originalOwnerTasks: owned.length,
      total: await hospitalDB.syncQueue.count(),
      mirror: local.getItem(key),
    });
    expect(owned).toMatchObject([retainedForA]);
    expect(await hospitalDB.syncQueue.count()).toBe(193);
  }
);

it('the same session still receives a failed persistence notice', async () => {
  const setup = setupHook();
  const h = renderHook(() => useDailyRecordSyncQuery(date), { wrapper: setup.wrapper });
  notices.error.mockClear();
  hospitalDB.syncQueue.hook('creating', abortHook);
  abortWrite = true;
  await act(async () => {
    await h.result.current.patchRecord(patch).catch(() => undefined);
  });
  expect(notices.error).toHaveBeenCalledWith('Cambio no guardado', expect.any(String));
  expect(value(setup.client)).toBe('BASE');
});

it('retention preserves every authored task field, including base, mutation identity and order', async () => {
  const h = setupHook();
  await act(async () => {
    await h.result.current.mutateAsync(patch);
  });
  const before = (await hospitalDB.syncQueue.toArray())[0];
  const author = captureAuthoringSession();
  const {
    id: _id,
    patchBaseValues: _values,
    patchBaseContext: _context,
    localProjectionBaseIds: _ids,
    ...raw
  } = before;
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:C1-B');
  await hospitalDB.dailyRecords.put(base);
  const result = await createDexieSyncQueueStore().saveDailyRecordWithTask(
    before.payload as typeof base,
    raw,
    { baseRecord: base, patch, prepare: (record, changes) => applyPatches(record, changes) },
    undefined,
    author
  );
  const retained = (await hospitalDB.syncQueue.toArray()).find(task => task.id !== before.id)!;
  expect(result).toBe('retained_for_owner');
  expect(before.patchBaseValues).toEqual({ 'beds.R1.pathology': 'BASE' });
  expect(before.patchBaseContext).toBeDefined();
  expect(retained).toEqual({
    ...before,
    ...sessionClosedTaskState(),
    projectionReleased: true,
    id: retained.id,
  });
  expect(retained.id).toBeGreaterThan(before.id!);
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});
