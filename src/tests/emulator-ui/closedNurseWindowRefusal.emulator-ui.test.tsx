/* @flake-safe: Synthetic census days counted from today on the hospital clock (two days back is past the nurse window, today is inside it, a week back is the administrator's); the rules and the shipped handler judge with real time, as in production. */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/context/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { buildSyncQueueStats } from '@/features/rayen-import/hooks/syncQueueMonitorController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import {
  getSyncQueueTelemetry,
  listRecentSyncQueueOperations,
  processSyncQueue,
} from '@/services/storage/sync';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/session/sessionScopedStorageService';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { addCalendarDays } from '@/utils/clinicalDateUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

/**
 * SAVE-04 after the window: a nurse's edit written without network that reaches the server only
 * after her 48 h closed is refused for good. This computer then shows what the server has for that
 * day and takes other computers' changes again; the unsent edit stays only in its stopped send, for
 * her to download and discard. A refusal inside the window and the administrator's old days keep
 * today's behaviour. Real rules, the shipped authority handler, the Firestore emulator and the
 * census hook.
 */
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({ db: undefined as unknown, role: 'nurse_hospital' }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async () => {
    throw new Error(`unexpected callable ${name}`);
  },
}));
vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  get db() {
    return h.db;
  },
  auth: {
    currentUser: {
      uid: 'synthetic-N',
      email: 'synthetic-N@example.invalid',
      isAnonymous: false,
      getIdTokenResult: async () => ({ claims: { role: h.role } }),
    },
  },
  firebaseReady: Promise.resolve(),
  storage: {},
  functions: {},
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(async () => ({})),
  getRegionalFunctionsInstance: vi.fn(async () => ({})),
  mountConfigWarning: vi.fn(),
}));

const projectId = 'demo-hhr-closed-nurse-window';
const AUTHOR = 'user:synthetic-N';
const NOTE = 'NOTA ESCRITA SIN RED';
const DIAGNOSIS = 'DIAGNOSTICO ESCRITO SIN RED';
const CORRECTION = 'CORRECCION DE OTRO EQUIPO';
const night = 'handoffNovedadesNightShift';
const today = getTodayISO();
const closedDay = addCalendarDays(today, -2);

type Field = 'note' | 'diagnosis';
const valueOf = (record: DailyRecord | null | undefined, field: Field) =>
  field === 'note' ? record?.[night] : record?.beds?.R1?.pathology;
const patchFor = (record: DailyRecord, field: Field): DailyRecordPatch =>
  field === 'note'
    ? { [night]: NOTE }
    : (bedManagementReducer(record, {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value: DIAGNOSIS,
      }) as DailyRecordPatch);
const edited = (field: Field) => (field === 'note' ? NOTE : DIAGNOSIS);

const base = (date: string): DailyRecord =>
  JSON.parse(
    JSON.stringify(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: new Date(Date.parse('2026-01-01T00:00:00.000Z')).toISOString(),
        dateTimestamp: clinicalWallClockToDate(date, '00:00').getTime(),
        handoffNovedadesDayShift: 'DIA BASE',
        handoffNovedadesNightShift: 'NOCHE BASE',
        discharges: [],
        transfers: [],
        cma: [],
        activeExtraBeds: [],
        beds: {
          ...DataFactory.createMockDailyRecord(date).beds,
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'ANA SINTETICA',
            rut: '12.345.678-5',
            admissionDate: date,
            clinicalEpisodeId: 'synthetic-episode-R1',
            pathology: 'DIAGNOSTICO BASE',
            age: '40',
          }),
        },
      })
    )
  );

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let client: QueryClient;
const server = async (date: string) =>
  (await admin.doc(`hospitals/hanga_roa/dailyRecords/${date}`).get()).data() as DailyRecord;
const shown = (date: string) =>
  client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record;
const actAs = (role: string) => {
  h.role = role;
  h.db = env
    .authenticatedContext('synthetic-N', { role, email: 'synthetic-N@example.invalid' })
    .firestore();
};

/** What this person sees in the Eloísa box for this computer's stopped sends. */
const panel = async () => {
  const operations = await listRecentSyncQueueOperations(5);
  const view = render(
    <RayenSyncQueueDetails
      stats={buildSyncQueueStats(await getSyncQueueTelemetry())}
      operations={operations}
      refresh={async () => undefined}
      working={false}
    />
  );
  const text = view.container.textContent ?? '';
  const buttons = Array.from(view.container.querySelectorAll('button')).map(
    button => button.textContent
  );
  view.unmount();
  return { text, buttons };
};

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'closed-nurse-window');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  // The queue runs only when a test says so.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const context = () => ({
    auth: { uid: 'synthetic-N', token: { email: 'synthetic-N@example.invalid' } },
  });
  // Only the callable transport is replaced: the shipped handlers run their real transactions.
  const authorityApi = createDailyRecordWriteAuthorityFunctions({
    firestore: admin,
    Timestamp,
    resolveRoleForEmail: async () => h.role,
  });
  vi.spyOn(authority, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
    async payload => {
      try {
        return await authorityApi.patchDailyRecordWithClinicalAuthority.run(payload, context());
      } catch (error) {
        throw authority.normalizeDailyRecordAuthorityError(error);
      }
    }
  );
  vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
    async payload => {
      try {
        return await authorityApi.saveDailyRecordWithClinicalAuthority.run(payload, context());
      } catch (error) {
        throw authority.normalizeDailyRecordAuthorityError(error);
      }
    }
  );
});
beforeEach(async () => {
  actAs('nurse_hospital');
  await env.clearFirestore();
  await clearSessionScopedClientState('manual');
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
    schemaVersion: 2,
    mode: 'preview',
    revision: 7,
    clinicalBatchMode: 'enforced',
  });
  setFirestoreEnabled(true);
  await reconcileAuthorizedSessionOwner(AUTHOR);
});
afterEach(() => {
  cleanup();
  client?.clear();
  client?.unmount();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await deleteApp(app);
});

/** The census of `date` on this computer, open on the server's day. */
const censusOf = async (date: string) => {
  const day = base(date);
  await admin.doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(day);
  await hospitalDB.dailyRecords.put(day);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  client.mount();
  setDailyRecordQueryData(client, date, day);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    ({ live }: { live: boolean }) => {
      useDailyRecordQuery(date, false, live ? 'ready' : 'local_only');
      return usePatchDailyRecordMutation(date);
    },
    { wrapper, initialProps: { live: true } }
  );
  const edit = async (field: Field) => {
    let payload: { result?: DailyRecordWriteResult } = {};
    await act(async () => {
      payload = (await hook.result.current.mutateAsync({
        date,
        partial: patchFor(shown(date)!, field),
      } as never)) as typeof payload;
    });
    return payload.result;
  };
  return { hook, edit };
};

/** Written without network, then the network is back and the queue sends it. */
const editOfflineThenSend = async (census: Awaited<ReturnType<typeof censusOf>>, field: Field) => {
  setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
  const result = await census.edit(field);
  expect(result).toMatchObject({ savedHere: true, state: 'local', cause: 'stored' });
  await sendQueueLater(census);
};

/** The network is back a few minutes later, past the queue's short hold, and the queue sends. */
const sendQueueLater = async ({ hook }: Awaited<ReturnType<typeof censusOf>>) => {
  setFirestoreEnabled(true);
  // The app renders the census again when the connection is back.
  hook.rerender({ live: true });
  const realNow = Date.now.bind(Date);
  const later = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60_000);
  try {
    await act(async () => {
      await processSyncQueue();
    });
  } finally {
    later.mockRestore();
  }
};

describe.each(['note', 'diagnosis'] as const)('%s refused because the window closed', field => {
  it('shows the server’s day, takes other computers’ changes and keeps the edit only in its send', async () => {
    const census = await censusOf(closedDay);
    await editOfflineThenSend(census, field);

    // (c) Nothing reached the server; the send stays stopped for its author, with its text.
    expect(valueOf(await server(closedDay), field)).not.toBe(edited(field));
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task).toMatchObject({
      status: 'FAILED',
      ownerKey: AUTHOR,
      projectionReleased: true,
    });
    expect(task.lastErrorCode).toMatch(/permission-denied$/);
    expect(valueOf(task.payload as DailyRecord, field)).toBe(edited(field));
    expect(await panel()).toMatchObject({
      text: expect.stringContaining('Plazo de edición cerrado'),
      buttons: ['Descartar envío'],
    });

    // (a) The census shows the server's value, and this computer's copy of the day is the server's.
    await waitFor(() =>
      expect(valueOf(shown(closedDay), field)).toBe(valueOf(base(closedDay), field))
    );
    expect(valueOf(await hospitalDB.dailyRecords.get(closedDay), field)).toBe(
      valueOf(base(closedDay), field)
    );

    // (b) A later correction from another computer appears here.
    await admin
      .doc(`hospitals/hanga_roa/dailyRecords/${closedDay}`)
      .update({ handoffNovedadesDayShift: CORRECTION, lastUpdated: Timestamp.now() });
    await waitFor(() => expect(shown(closedDay)?.handoffNovedadesDayShift).toBe(CORRECTION), {
      timeout: 10_000,
    });
    expect(valueOf(shown(closedDay), field)).toBe(valueOf(base(closedDay), field));
    census.hook.unmount();

    // (d) Reloading reads the same; so does another person here, and the author finds her send.
    const reread = await getForDateWithMeta(closedDay);
    expect(reread.record?.handoffNovedadesDayShift).toBe(CORRECTION);
    expect(valueOf(reread.record, field)).toBe(valueOf(base(closedDay), field));
    await reconcileAuthorizedSessionOwner('user:synthetic-other');
    expect(valueOf((await getForDateWithMeta(closedDay)).record, field)).toBe(
      valueOf(base(closedDay), field)
    );
    expect((await panel()).buttons).toEqual([]);
    await reconcileAuthorizedSessionOwner(AUTHOR);
    expect(await panel()).toMatchObject({
      text: expect.stringContaining('Plazo de edición cerrado'),
      buttons: ['Descartar envío'],
    });
    const [kept] = await hospitalDB.syncQueue.toArray();
    expect(kept).toMatchObject({ status: 'FAILED', ownerKey: AUTHOR });
    expect(valueOf(kept.payload as DailyRecord, field)).toBe(edited(field));
    expect(valueOf(await server(closedDay), field)).not.toBe(edited(field));
  }, 60_000);
});

it('(e) a refusal inside the window keeps the edit on screen and offers the retry, as before', async () => {
  const census = await censusOf(today);
  setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
  await census.edit('note');
  // The account loses its write role before the send.
  actAs('viewer');
  await sendQueueLater(census);

  const [task] = await hospitalDB.syncQueue.toArray();
  expect(task.status).toBe('FAILED');
  expect(task.lastErrorCode).toMatch(/permission-denied$/);
  expect(task.projectionReleased).toBeUndefined();
  expect((await hospitalDB.dailyRecords.get(today))?.[night]).toBe(NOTE);
  expect(shown(today)?.[night]).toBe(NOTE);
  expect(await panel()).toMatchObject({
    text: expect.stringContaining('Sin permisos'),
    buttons: ['Descartar envío', 'Reintentar'],
  });
  census.hook.unmount();
}, 60_000);

it.each(['note', 'diagnosis'] as const)(
  '(f) the administrator’s %s on a day a week old reaches the server and is shown',
  async field => {
    actAs('admin');
    const weekAgo = addCalendarDays(today, -7);
    const census = await censusOf(weekAgo);
    const result = await census.edit(field);

    expect(result?.state).toBe('confirmed');
    expect(valueOf(await server(weekAgo), field)).toBe(edited(field));
    expect(valueOf(shown(weekAgo), field)).toBe(edited(field));
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    census.hook.unmount();
  },
  60_000
);
