import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { DailyRecordWriteBlockedOutcomeError } from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import {
  flushDailyActionTimings,
  startDailyActionTiming,
} from '@/services/observability/dailyActionTiming';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import type { ApplyDailyRecordPatchOptions } from '@/application/shared/dailyRecordCoreContracts';
import * as freshness from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import * as writeService from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { authoredOptions } from '@/services/storage/authoringSession';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  isDailyRecordWriteRejectedResult,
  type DailyRecordWriteResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  BEFORE,
  EDIT,
  NEXT_OWNER,
  NOTE_PATCH,
  PARITY_DATE,
  PARITY_OWNER,
  endSession,
  firestoreError,
  readLocalDurability,
  resetParityWorld,
} from '@/tests/services/repositories/dailyRecordWriteResultParity.test-support';
import {
  endSessionHook,
  server,
  type ServerAnswer,
} from '@/tests/services/repositories/dailyRecordWriteResultParityServer.test-support';

const port = vi.hoisted(() => ({
  getForDate: vi.fn(),
  getForDateWithMeta: vi.fn(),
  getAuthoritativeForDate: vi.fn(),
  getLocalForDate: vi.fn(),
  getLocalForDateWithMeta: vi.fn(),
  adoptAuthoritativeRecord: vi.fn(async (record: unknown) => record),
  save: vi.fn(),
  saveDetailed: vi.fn(),
  subscribeDetailed: vi.fn(() => vi.fn()),
  updatePartial: vi.fn(),
  updatePartialDetailed: vi.fn(),
  initializeDay: vi.fn(),
  delete: vi.fn(),
  deleteDay: vi.fn(),
  getPreviousDay: vi.fn(),
  getPreviousDayWithMeta: vi.fn(),
  getAvailableDates: vi.fn(),
  getMonthRecords: vi.fn(),
  copyPatientToDateDetailed: vi.fn(),
}));
const notices = vi.hoisted(() => [] as string[][]);

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: port,
  defaultDailyRecordWritePort: {
    updatePartial: port.updatePartialDetailed,
    save: port.saveDetailed,
  },
  defaultDailyRecordRepositoryPort: port,
}));
vi.mock('@/context/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/context/RepositoryContext')>()),
  useRepositories: () => ({ dailyRecord: port }),
}));
vi.mock('@/context/UIContext', async importOriginal => {
  const record =
    (channel: string) =>
    (...args: string[]) =>
      notices.push([channel, ...args]);
  const channels = {
    success: record('success'),
    warning: record('warning'),
    error: record('error'),
  };
  return {
    ...(await importOriginal<typeof import('@/context/UIContext')>()),
    useNotification: () => channels,
  };
});
vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ checkVersion: vi.fn(), currentVersion: 1, isOutdated: false }),
}));
vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: vi.fn(async () => ({
    success: true,
    data: { date: '2026-11-17', outcome: 'clean', record: null },
  })),
}));
vi.mock('@/utils/dateCoreUtils', async () => ({
  ...(await vi.importActual('@/utils/dateCoreUtils')),
  getTodayISO: () => '2026-11-17',
}));
vi.mock('@/services/repositories/repositoryConfig', async () =>
  (
    await import('@/tests/services/repositories/dailyRecordWriteResultParityServer.test-support')
  ).scriptedRepositoryConfig()
);
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal =>
  (
    await import('@/tests/services/repositories/dailyRecordWriteResultParityServer.test-support')
  ).scriptedFirestoreRecordWrites(importOriginal)
);
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal =>
  (
    await import('@/tests/services/repositories/dailyRecordWriteResultParityServer.test-support')
  ).scriptedFirestoreRecordQueries(importOriginal)
);
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/services/observability/operationalTelemetryExternalAdapter')
  >()),
  dispatchOperationalTelemetryExternally: vi.fn(async () => undefined),
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { getCurrentUser: () => ({ uid: 'synthetic-parity-A' }) },
}));

/**
 * W14-D1-1 — H1 and H3 as the person sees them (DISENO-AJUSTES.md, ajuste 5). The census hooks
 * are mounted over the shipped repository on this computer's Dexie and real sync queue; the
 * server's answer is the only scripted input. Each test pins today's behaviour; where it
 * contradicts the contract the case says so and REPORT.md describes it. Nothing is fixed here.
 */
const readResult = (record: DailyRecord | null) => ({
  serverConfirmed: true,
  date: PARITY_DATE,
  record,
  source: 'indexeddb' as const,
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: 'local_only' as const,
  sourceOfTruth: 'local' as const,
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read'],
  repairApplied: false,
});

const newClient = () =>
  new QueryClient({
    // The app's census staleTime (queryClient.ts): a cached day is not read again for 5 minutes.
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};
const shownNote = (client: QueryClient) =>
  client.getQueryData<{ record: DailyRecord | null }>(getDailyRecordQueryKey(PARITY_DATE))?.record
    ?.handoffNovedadesNightShift;

beforeEach(async () => {
  notices.length = 0;
  onlineManager.setOnline(true);
  await resetParityWorld();
  // The repository behind the port is the shipped one; the census reads this computer's row.
  port.updatePartialDetailed.mockImplementation((date, patch, options) =>
    writeService.updatePartialDetailed(date, patch, authoredOptions(options ?? {}))
  );
  port.getForDateWithMeta.mockImplementation(async () =>
    readResult((await hospitalDB.dailyRecords.get(PARITY_DATE)) ?? null)
  );
  vi.spyOn(freshness, 'ensureFreshClinicalPatchMutation').mockImplementation(async () =>
    createDailyRecordQueryResult((await hospitalDB.dailyRecords.get(PARITY_DATE)) ?? null, {
      ...readResult(null),
      availabilityState: 'resolved',
    })
  );
});
afterEach(() => {
  cleanup();
  endSessionHook.current = endSession;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('H1: the server refuses for good an edit already in the queue', () => {
  // W14-D1 H1: contradice SAVE-01 (ver REPORT). The notice says «saved locally» and that local
  // copy does exist; what is inconsistent is the flow that rejects, the cell that reverts and
  // the durable copy that brings the edit back. No server save is claimed.
  it('says «saved locally», reverts the cell, fails the row, keeps the edit for reload', async () => {
    server.answer = { kind: 'refuses', error: () => firestoreError('permission-denied') };
    const client = newClient();
    const { result } = renderHook(() => useDailyRecordSyncQuery(PARITY_DATE, 'ready'), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(result.current.record?.handoffNovedadesNightShift).toBe(BEFORE));

    const cellHistory: unknown[] = [];
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const note = shownNote(client);
      if (cellHistory.at(-1) !== note) cellHistory.push(note);
    });
    let rowError: unknown;
    await act(async () => {
      await result.current.patchRecord(NOTE_PATCH).catch(error => (rowError = error));
    });

    // What the nurse sees: one calm notice that it was saved on this computer…
    expect(notices).toEqual([
      [
        'warning',
        'Cambio local sin sincronización',
        'Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      ],
    ]);
    // …the row's save promise fails (bedManagementDispatchController.ts:394-396 → «falló»)…
    expect(rowError).toBeInstanceOf(DailyRecordWriteBlockedOutcomeError);
    unsubscribe();
    // …the cell showed the edit, then the previous text again; the sync box says «local».
    expect(cellHistory.slice(0, 2)).toEqual([EDIT, BEFORE]);
    await waitFor(() => expect(result.current.syncStatus).toBe('local'));
    // What this computer keeps: the edited row and a pending task that will be sent again.
    expect(await readLocalDurability()).toEqual({
      cola: { 'PENDING de quien editó': 1 },
      notaGuardada: EDIT,
    });

    // The next read of the day (focus, reconnect, a refresh) shows the edit back in the cell…
    await act(async () => {
      await client.refetchQueries({ queryKey: getDailyRecordQueryKey(PARITY_DATE) });
    });
    expect(shownNote(client)).toBe(EDIT);
    // …and so does a reload: the shipped read service returns this computer's copy.
    const reloaded = await getForDateWithMeta(PARITY_DATE);
    expect(reloaded.record?.handoffNovedadesNightShift).toBe(EDIT);

    // What the queue's resend does against the real rules is not measured here: the replay
    // goes through runTransaction/getDoc, which this unit harness does not script (see REPORT).
  });
});

describe('the census edit timing event (useDailyRecordSyncQuery.ts:263)', () => {
  it.each<[string, ServerAnswer, { count: number; degradedCount: number }]>([
    ['the server confirms the edit', { kind: 'accepts' }, { count: 1, degradedCount: 0 }],
    [
      'the edit waits in the queue (no network)',
      { kind: 'refuses', error: () => firestoreError('unavailable') },
      { count: 1, degradedCount: 1 },
    ],
  ])('counts «%s» as reported in the operational summary', async (_label, answer, counts) => {
    server.answer = answer;
    flushDailyActionTimings();
    const stopTiming = startDailyActionTiming();
    vi.mocked(dispatchOperationalTelemetryExternally).mockClear();
    const client = newClient();
    const { result } = renderHook(() => useDailyRecordSyncQuery(PARITY_DATE, 'ready'), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(result.current.record?.handoffNovedadesNightShift).toBe(BEFORE));
    await act(async () => {
      await result.current.patchRecord(NOTE_PATCH);
    });
    flushDailyActionTimings();
    stopTiming();
    const editSummaries = vi
      .mocked(dispatchOperationalTelemetryExternally)
      .mock.calls.map(([event]) => event)
      .filter(event => event.operation === 'census_edit_saved');
    expect(editSummaries).toHaveLength(1);
    expect(editSummaries[0].context).toMatchObject(counts);
  });
});

/**
 * Logout as the app runs it: the census unmounts, the session-scoped state is cleared
 * (clearSessionScopedClientState), the query cache is cleared (useAuthState.ts:254) and the next
 * person signs in. The server's answer to the send arrives after all of that.
 */
const lastWrite: { result?: DailyRecordWriteResult } = {};
const sendDuringSessionEnd = async (options?: ApplyDailyRecordPatchOptions) => {
  lastWrite.result = undefined;
  const client = newClient();
  const census = renderHook(() => useDailyRecordSyncQuery(PARITY_DATE, 'ready'), {
    wrapper: wrap(client),
  });
  await waitFor(() =>
    expect(census.result.current.record?.handoffNovedadesNightShift).toBe(BEFORE)
  );
  let shownToAuthorDuringSend: unknown;
  const shippedWrite = port.updatePartialDetailed.getMockImplementation()!;
  port.updatePartialDetailed.mockImplementation(async (...args) => {
    shownToAuthorDuringSend = shownNote(client);
    lastWrite.result = await shippedWrite(...args);
    return lastWrite.result;
  });
  endSessionHook.current = async () => {
    census.unmount();
    await clearSessionScopedClientState('manual');
    client.clear();
    await reconcileAuthorizedSessionOwner(NEXT_OWNER);
  };
  let promesa = '';
  await act(async () => {
    promesa = await census.result.current.patchRecord(NOTE_PATCH, options).then(
      () => 'resuelve',
      (error: Error) => `rechaza ${error.name}: ${error.message}`
    );
  });
  // The next person's census mounts with the shipped reader and the app's 5-minute staleTime.
  const readsBefore = port.getForDateWithMeta.mock.calls.length;
  const next = renderHook(() => useDailyRecordQuery(PARITY_DATE, false, 'local_only'), {
    wrapper: wrap(client),
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
  });
  const sesionSiguiente = {
    muestra: next.result.current.data?.handoffNovedadesNightShift ?? 'sin censo',
    lecturasDelDia: port.getForDateWithMeta.mock.calls.length - readsBefore,
  };
  next.unmount();
  return {
    promesa,
    avisos: [...notices],
    mostradoAQuienEditaDuranteElEnvio: shownToAuthorDuringSend,
    sesionSiguiente,
    ...(await readLocalDurability()),
  };
};

describe('H3: the session ends while a census edit is on its way', () => {
  it('direct send: the promise resolves silently and the next session reads the day itself', async () => {
    server.answer = {
      kind: 'refuses_after_session_ends',
      error: () => firestoreError('unavailable'),
    };
    const seen = await sendDuringSessionEnd();
    process.stdout.write(`H3 direct ${JSON.stringify(seen)}\n`);
    // W16-SR1: the edit is safe with its author, so its state is «kept here», never refused.
    const [task] = await hospitalDB.syncQueue.toArray();
    expect({
      estado: lastWrite.result,
      rechazado: isDailyRecordWriteRejectedResult(lastWrite.result),
      cuadro: resolveDailyRecordSyncStatus([
        { isPending: false, isError: false, isSuccess: true, data: { result: lastWrite.result! } },
      ]),
      tarea: {
        dueño: task.ownerKey === PARITY_OWNER ? 'quien editó' : task.ownerKey,
        nota: (task.payload as DailyRecord).handoffNovedadesNightShift,
      },
    }).toEqual({
      estado: expect.objectContaining({
        savedHere: true,
        state: 'held',
        reason: 'session_changed',
      }),
      rechazado: false,
      cuadro: 'local',
      tarea: { dueño: 'quien editó', nota: EDIT },
    });
    expect(seen).toEqual({
      promesa: 'resuelve',
      avisos: [],
      mostradoAQuienEditaDuranteElEnvio: 'NOTA SINTETICA A',
      sesionSiguiente: {
        muestra: 'sin censo',
        lecturasDelDia: 1,
      },
      cola: {
        'FAILED de quien editó session_owner_logged_out': 1,
      },
      notaGuardada: undefined,
    });
  });

  it('server first: the promise rejects silently and the next session reads the day itself', async () => {
    server.answer = {
      kind: 'refuses_after_session_ends',
      error: () => firestoreError('permission-denied'),
    };
    const seen = await sendDuringSessionEnd({ consistency: 'remote_confirmed' });
    process.stdout.write(`H3 server-first ${JSON.stringify(seen)}\n`);
    expect(seen).toEqual({
      promesa:
        'rechaza DailyRecordWriteBlockedOutcomeError: La sesión cambió. La operación no fue enviada ni guardada.',
      avisos: [],
      mostradoAQuienEditaDuranteElEnvio: 'NOCHE BASE',
      sesionSiguiente: {
        muestra: 'sin censo',
        lecturasDelDia: 1,
      },
      cola: {},
      notaGuardada: undefined,
    });
  });

  // The late rollback no longer writes the departing session's census into the cleared cache:
  // the next session's reader reads the day itself.
  it('server first shown at once (crib creation): the next session reads the day itself', async () => {
    server.answer = {
      kind: 'refuses_after_session_ends',
      error: () => firestoreError('permission-denied'),
    };
    const seen = await sendDuringSessionEnd({
      consistency: 'remote_confirmed',
      optimisticRemoteConfirmed: true,
    });
    process.stdout.write(`H3 server-first-optimistic ${JSON.stringify(seen)}\n`);
    expect(seen).toEqual({
      promesa:
        'rechaza DailyRecordWriteBlockedOutcomeError: La sesión cambió. La operación no fue enviada ni guardada.',
      avisos: [],
      mostradoAQuienEditaDuranteElEnvio: 'NOTA SINTETICA A',
      sesionSiguiente: {
        muestra: 'sin censo',
        lecturasDelDia: 1,
      },
      cola: {},
      notaGuardada: undefined,
    });
  });
});
