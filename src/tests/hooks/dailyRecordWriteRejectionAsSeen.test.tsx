import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { DailyRecordWriteBlockedOutcomeError } from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import * as freshness from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import * as writeService from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { authoredOptions, captureAuthoringSession } from '@/services/storage/authoringSession';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  BEFORE,
  EDIT,
  NOTE_PATCH,
  PARITY_DATE,
  endSession,
  firestoreError,
  readLocalDurability,
  resetParityWorld,
} from '@/tests/services/repositories/dailyRecordWriteResultParity.test-support';
import {
  endSessionHook,
  server,
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
  syncWithFirestoreDetailed: vi.fn(),
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
  defaultDailyRecordSyncPort: { syncWithFirestoreDetailed: port.syncWithFirestoreDetailed },
  defaultDailyRecordRepositoryPort: port,
}));
vi.mock('@/services/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/RepositoryContext')>()),
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } },
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
  vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
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
  // W14-D1 H1: contradice SAVE-01 (ver REPORT): the notice says it was saved here, the cell
  // goes back and the row says it failed, while this computer keeps the edit and its task.
  it('says «saved locally», reverts the cell, fails the row, keeps the edit for reload', async () => {
    server.answer = { kind: 'refuses', error: () => firestoreError('permission-denied') };
    const client = newClient();
    const { result } = renderHook(() => useDailyRecordSyncQuery(PARITY_DATE, false, 'ready'), {
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

/** Logout as the app runs it: the query cache is cleared (useAuthState.ts:254), then B signs in. */
const endSessionAndClear = (client: QueryClient) => () => {
  endSession();
  client.clear();
};

const sendDuringSessionEnd = async (options: Record<string, unknown>) => {
  const client = newClient();
  const shown = (await hospitalDB.dailyRecords.get(PARITY_DATE)) as DailyRecord;
  setDailyRecordQueryData(client, PARITY_DATE, shown);
  endSessionHook.current = endSessionAndClear(client);
  const { result } = renderHook(() => usePatchDailyRecordMutation(PARITY_DATE), {
    wrapper: wrap(client),
  });
  let shownDuringSend: unknown;
  port.updatePartialDetailed.mockImplementation(async (date, patch, writeOptions) => {
    shownDuringSend = shownNote(client);
    return writeService.updatePartialDetailed(date, patch, authoredOptions(writeOptions ?? {}));
  });
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current
      .mutateAsync({
        date: PARITY_DATE,
        partial: NOTE_PATCH,
        options: { ...options, authoringSession: captureAuthoringSession() },
      })
      .then(payload => payload.result?.outcome)
      .catch(error => `lanza ${(error as Error).name}`);
  });
  return {
    outcome,
    shownToAuthorDuringSend: shownDuringSend,
    // The cache B's census starts from after logout cleared it: undefined = nothing of A's.
    shownToNextSession: shownNote(client),
    ...(await readLocalDurability()),
  };
};

describe('H3: the session ends while a census edit is on its way', () => {
  // W14-D1 H3: the two routes answer differently (queued vs rejected), but the next session
  // sees nothing of the departing person's edit on either route.
  it('direct send: the author keeps the edit on screen; the next session sees nothing', async () => {
    server.answer = {
      kind: 'refuses_after_session_ends',
      error: () => firestoreError('unavailable'),
    };
    const seen = await sendDuringSessionEnd({});
    process.stdout.write(`H3 direct ${JSON.stringify(seen)}\n`);
    expect(seen).toEqual({
      outcome: 'queued',
      shownToAuthorDuringSend: EDIT,
      shownToNextSession: undefined,
      cola: { 'PENDING de quien editó': 1 },
      notaGuardada: EDIT,
    });
  });

  it('server first: the edit is never shown, is rejected, and the next session sees nothing', async () => {
    server.answer = {
      kind: 'refuses_after_session_ends',
      error: () => firestoreError('permission-denied'),
    };
    const seen = await sendDuringSessionEnd({
      requireRemoteAuthorityFirst: true,
      requireConfirmedRecord: true,
    });
    process.stdout.write(`H3 server-first ${JSON.stringify(seen)}\n`);
    expect(seen).toEqual({
      outcome: 'unrecoverable',
      shownToAuthorDuringSend: BEFORE,
      shownToNextSession: undefined,
      cola: {},
      notaGuardada: BEFORE,
    });
  });

  // W14-D1 H3: contradice la regla de cambio de sesión (ver REPORT): after logout cleared the
  // cache, the late rollback writes the departing session's census into the next session's.
  it('server first with the edit shown at once (crib-style): the late rollback refills the cache', async () => {
    server.answer = {
      kind: 'refuses_after_session_ends',
      error: () => firestoreError('permission-denied'),
    };
    const seen = await sendDuringSessionEnd({
      requireRemoteAuthorityFirst: true,
      requireConfirmedRecord: true,
      requireAtomicCas: true,
      optimisticRemoteConfirmed: true,
    });
    process.stdout.write(`H3 server-first-optimistic ${JSON.stringify(seen)}\n`);
    expect(seen).toEqual({
      outcome: 'unrecoverable',
      shownToAuthorDuringSend: EDIT,
      shownToNextSession: BEFORE,
      cola: {},
      notaGuardada: BEFORE,
    });
  });
});
