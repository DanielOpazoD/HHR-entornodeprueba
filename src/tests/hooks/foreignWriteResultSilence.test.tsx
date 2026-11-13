import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import {
  setDailyRecordQueryData,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
const notices = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('@/context/UIContext', () => ({ useNotification: () => notices }));
vi.mock('@/context/VersionContext', () => ({ useVersion: () => ({ checkVersion: vi.fn() }) }));
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  setSessionGeneration,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import type { DailyRecord } from '@/types/domain/dailyRecord';
vi.unmock('@/application/ports/dailyRecordPort');
const remote = vi.hoisted(() => ({
  record: null as DailyRecord | null,
  specialist: false,
  write: vi.fn(),
  read: vi.fn(),
  enabled: true,
  reason: 'enabled' as string,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestore: (...args: unknown[]) => remote.read(...args),
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<
    typeof import('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting')
  >()),
  shouldRouteSpecialistPatchViaCallable: async () => remote.specialist,
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreRecordWrites')>()),
  updateRecordPartial: remote.write,
  saveRecordToFirestore: remote.write,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => remote.enabled,
  getFirestoreSyncState: () => ({
    mode: remote.enabled ? 'enabled' : 'disabled',
    reason: remote.reason,
  }),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const frame = document.createElement('iframe');
document.body.append(frame);
const local = frame.contentWindow!.localStorage,
  session = frame.contentWindow!.sessionStorage;
afterAll(() => frame.remove());
const date = '2026-11-12';
let base: DailyRecord & { meta?: { revision: number } };
const nextRow = () => ({ ...base, nursesDayShift: ['SYNTHETIC B ROW'] });
const nextTask = () => ({
  id: 800,
  opId: 'synthetic-b-pending',
  type: 'UPDATE_DAILY_RECORD' as const,
  payload: nextRow(),
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING' as const,
  ownerKey: 'user:synthetic-B',
  key: `daily:${date}`,
});
const changeSession = async () => {
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
  await hospitalDB.dailyRecords.put(nextRow());
  await hospitalDB.syncQueue.put(nextTask());
};
beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  resetMedicalHandoffDraftMemoryForTests();
  resetDailyRecordFreshnessGateForTests();
  onlineManager.setOnline(true);
  Object.values(notices).forEach(n => n.mockClear());
  vi.mocked(recordOperationalTelemetry).mockClear();
  local.clear();
  session.clear();
  setSessionGeneration('synthetic-A');
  local.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  local.setItem(SESSION_GENERATION_KEY, 'synthetic-A');
  await hospitalDB.open();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  base = DataFactory.createMockDailyRecord(date);
  base.beds = {
    R1: {
      ...base.beds.R1,
      patientName: 'SYNTHETIC PATIENT',
      clinicalEpisodeId: 'synthetic-episode',
      specialty: 'Medicina',
    },
  };
  base.meta = { revision: 1 };
  await hospitalDB.dailyRecords.put(base);
  remote.record = base;
  remote.enabled = true;
  remote.reason = 'enabled';
  remote.read.mockReset();
  remote.read.mockImplementation(async () => remote.record);
  remote.write.mockReset();
  remote.write.mockImplementation(async () => ({
    recordState: { record: base, lastUpdated: base.lastUpdated, meta: base.meta },
  }));
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

it.each(['success', 'conflict', 'permission', 'network'] as const)(
  'foreign patch %s stays silent',
  async outcome => {
    await runCase(outcome, true, false);
  }
);
it.each(['success', 'conflict', 'permission', 'network'] as const)(
  'same session patch %s preserves feedback',
  async outcome => {
    await runCase(outcome, false, false);
  }
);
it.each(['success', 'conflict'] as const)('foreign whole save %s stays silent', async outcome => {
  await runCase(outcome, true, true);
});
async function runCase(outcome: string, change: boolean, whole: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } },
  });
  setDailyRecordQueryData(client, date, base);
  const repository = buildMockDailyRecordRepository();
  repository.updatePartialDetailed = updatePartialDetailed;
  repository.saveDetailed = saveDetailed;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={createRepositoryContainer({ dailyRecord: repository })}>
        {children}
      </RepositoryProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useDailyRecordSyncQuery(date), { wrapper });
  let release!: () => void;
  const gate = new Promise<void>(r => {
    release = r;
  });
  const confirmed = {
    ...base,
    nursesDayShift: ['SERVER CONFIRMED A'],
    lastUpdated: '2026-11-12T12:00:05.000Z',
    meta: { revision: 2 },
  };
  remote.specialist = !whole;
  remote.write.mockImplementation(async () => {
    await gate;
    if (outcome === 'conflict')
      throw new ConcurrencyError('SYNTHETIC CONFLICT', 'semantic_conflict');
    if (outcome !== 'success')
      throw Object.assign(new Error('SYNTHETIC FAILURE'), {
        code: outcome === 'network' ? 'unavailable' : 'permission-denied',
      });
    remote.record = confirmed;
    return {
      recordState: { record: confirmed, lastUpdated: confirmed.lastUpdated, meta: confirmed.meta },
    };
  });
  let writing!: Promise<unknown>;
  try {
    act(() => {
      writing = (
        whole
          ? hook.result.current.saveAndUpdate({ ...base, nursesDayShift: ['A'] }, base)
          : hook.result.current.patchRecord(
              { 'beds.R1.medicalHandoffNote': 'SYNTHETIC A NOTE' },
              { consistency: 'remote_confirmed' }
            )
      ).catch(e => e);
    });
    await waitFor(() => expect(remote.write).toHaveBeenCalled());
    if (change)
      await act(async () => {
        await changeSession();
        setDailyRecordQueryData(client, date, nextRow());
      });
    Object.values(notices).forEach(n => n.mockClear());
    await act(async () => {
      release();
      await writing;
    });
    const cached = client.getQueryData<{ record: DailyRecord }>(
      getDailyRecordQueryKey(date)
    )?.record;
    console.log(
      JSON.stringify({
        outcome,
        change,
        whole,
        notices: Object.fromEntries(Object.entries(notices).map(([k, v]) => [k, v.mock.calls])),
        status: hook.result.current.syncStatus,
        exception: hook.result.current.hasSaveException,
        cachedNotes: cached?.nursesDayShift,
        cachedNote: cached?.beds.R1.medicalHandoffNote,
      })
    );
    if (change) {
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(nextRow());
      expect(cached?.nursesDayShift).toEqual(nextRow().nursesDayShift);
      expect(cached?.beds.R1.medicalHandoffNote).not.toBe('SYNTHETIC A NOTE');
      if (outcome === 'network' && !whole)
        expect(await hospitalDB.syncQueue.toArray()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ ownerKey: 'user:synthetic-A', status: 'FAILED' }),
          ])
        );
      Object.values(notices).forEach(n => expect(n).not.toHaveBeenCalled());
      await waitFor(() => expect(hook.result.current.syncStatus).toBe('idle'));
      expect(hook.result.current.hasSaveException).toBe(false);
    } else {
      if (outcome === 'success')
        expect(notices.success).toHaveBeenCalledWith('Cambio guardado', expect.any(String));
      else if (outcome === 'network')
        expect(notices.warning).toHaveBeenCalledWith(
          'Cambio pendiente de sincronización',
          expect.any(String)
        );
      else
        expect(notices.error).toHaveBeenCalledWith(
          outcome === 'conflict' ? 'Conflicto de Edición' : 'Cambio no guardado',
          expect.any(String)
        );
    }
  } finally {
    release();
    await writing;
    cleanup();
    client.clear();
  }
}
