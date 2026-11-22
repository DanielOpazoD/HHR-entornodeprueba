/* @flake-safe: Synthetic census days counted from today on the hospital clock; the probes that move the device clock spy on Date.now around one step and restore it, while the rules and the shipped handler judge with real time, as in production. */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { disableNetwork } from 'firebase/firestore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/context/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { processSyncQueue } from '@/services/storage/sync';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { captureAuthoringSession } from '@/services/session/authoringSession';
import { setSessionGeneration } from '@/services/session/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/session/sessionOwnerKey';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import * as rebase from '@/services/repositories/dailyRecordPendingWriteRebase';
import {
  retireReviewedDailyRecordTask,
  reviewBlockedDailyRecordTask,
} from '@/services/storage/sync/dailyRecordTaskRetirement';
import { applyPatches } from '@/utils/patchUtils';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
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

/**
 * The recheck of W14-H1B (evidence/W14/H1B/recheck): releasing a refused send writes nothing on
 * the stored day. What the census shows comes from the next server read: the server's day with
 * the paths of the writes that still hold it, never a value the app guesses. No patient's data is
 * written by bed at the release, so a newborn or a bed that changed patient keeps its own data;
 * a failed read stays unconfirmed; and only the session this tab admitted releases its own sends.
 */
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  role: 'nurse_hospital',
  uid: 'synthetic-N',
}));
vi.mock('@/context/StaffContext', () => ({ useStaffContext: () => ({}) }));
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
      get uid() {
        return h.uid;
      },
      get email() {
        return `${h.uid}@example.invalid`;
      },
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

const projectId = 'demo-hhr-closed-window-server-read';
const AUTHOR = 'user:synthetic-N';
const ADMIN = 'user:synthetic-admin';
const NOTE = 'NOTA ESCRITA SIN RED';
const DIAGNOSIS = 'DIAGNOSTICO ESCRITO SIN RED';
const CORRECTION = 'CORRECCION DE OTRO EQUIPO';
const night = 'handoffNovedadesNightShift';
const today = getTodayISO();
const closedDay = addCalendarDays(today, -2);
const dayPath = `hospitals/hanga_roa/dailyRecords/${closedDay}`;

type Field = 'note' | 'diagnosis';
const patchFor = (record: DailyRecord, field: Field): DailyRecordPatch =>
  field === 'note'
    ? { [night]: NOTE }
    : (bedManagementReducer(record, {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value: DIAGNOSIS,
      }) as DailyRecordPatch);

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
const server = async () => (await admin.doc(dayPath).get()).data() as DailyRecord;
const stored = async () => hospitalDB.dailyRecords.get(closedDay);
const shown = () =>
  client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(closedDay))?.record;
const actAs = (role: string, uid = h.uid) => {
  h.uid = uid;
  h.role = role;
  h.db = env.authenticatedContext(uid, { role, email: `${uid}@example.invalid` }).firestore();
};
const offline = () => setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
const drain = async () => {
  await act(async () => {
    await processSyncQueue();
  });
};
const settled = async () => {
  await waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 25_000 });
};
const tasks = () => hospitalDB.syncQueue.toArray();

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'closed-window-server-read');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const context = () => ({ auth: { uid: h.uid, token: { email: `${h.uid}@example.invalid` } } });
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
  resetDailyRecordFreshnessGateForTests();
  actAs('nurse_hospital', 'synthetic-N');
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

/** The census of the closed day on this computer, confirmed against the server. */
const census = async () => {
  const day = base(closedDay);
  await admin.doc(dayPath).set(day);
  await hospitalDB.dailyRecords.put(day);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  client.mount();
  setDailyRecordQueryData(client, closedDay, day);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    ({ live }: { live: boolean }) => {
      useDailyRecordQuery(closedDay, false, live ? 'ready' : 'local_only');
      return usePatchDailyRecordMutation(closedDay);
    },
    { wrapper, initialProps: { live: true } }
  );
  await waitFor(
    () =>
      expect(
        client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(closedDay))?.runtime
          .serverConfirmed
      ).toBe(true),
    { timeout: 12_000 }
  );
  const edit = async (field: Field) => {
    await act(async () => {
      await hook.result.current.mutateAsync({
        date: closedDay,
        partial: patchFor(shown()!, field),
      } as never);
    });
  };
  const live = () => {
    setFirestoreEnabled(true);
    hook.rerender({ live: true });
  };
  return { hook, edit, live };
};

/** The send leaves after the queue's short hold. */
const sendLater = async () => {
  const realNow = Date.now.bind(Date);
  const later = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60_000);
  try {
    await drain();
  } finally {
    later.mockRestore();
  }
};

/**
 * A send of `patch` over `day`, refused by the server past the window, left stopped and not yet
 * released, as the build before this change left it. `afterRefusal` runs once it is refused.
 */
const refusedBeforeThisBuild = async (
  day: DailyRecord,
  patch: DailyRecordPatch,
  afterRefusal?: () => Promise<void>
): Promise<SyncTask> => {
  await admin.doc(dayPath).set(day);
  await hospitalDB.dailyRecords.put(day);
  expect(
    await queueDailyRecordSyncTaskWithLocalRecord(
      applyPatches(day, patch),
      { syncContract: { changedPaths: Object.keys(patch), expectedVersion: day.lastUpdated } },
      {
        deferProcessing: true,
        authoringSession: captureAuthoringSession(),
        patchWrite: { patch, baseRecord: day, prepare: applyPatches },
      }
    )
  ).toMatchObject({ accepted: true });
  const update = hospitalDB.syncQueue.update.bind(hospitalDB.syncQueue);
  const noRelease = vi
    .spyOn(hospitalDB.syncQueue, 'update')
    .mockImplementation(((key: number, changes: object) =>
      'projectionReleased' in changes
        ? Promise.reject(new Error('synthetic build without the release'))
        : update(key, changes)) as unknown as typeof hospitalDB.syncQueue.update);
  try {
    await sendLater();
  } finally {
    noRelease.mockRestore();
  }
  await afterRefusal?.();
  const [task] = await tasks();
  expect(task).toMatchObject({
    status: 'FAILED',
    lastErrorCode: expect.stringMatching(/permission-denied$/),
  });
  expect(task.projectionReleased).toBeUndefined();
  return task;
};

// Recheck finding 1: the newborn X is replaced by Y, whose confirmed diagnosis equals the text
// refused for X. The release writes nothing by bed, so Y keeps its own data here and offline.
it.each(['bed', 'move', 'crib'] as const)(
  'keeps the data of the patient now in the slot after a replacement (%s)',
  async kind => {
    const day = base(closedDay);
    const newborn = {
      ...day.beds.R1,
      clinicalEpisodeId: 'ep_RNX',
      rut: '11.111.111-1',
      patientName: 'RN X',
      pathology: 'BASE EXCLUSIVA X',
    };
    if (kind === 'crib') day.beds.R1.clinicalCrib = newborn;
    const path = kind === 'crib' ? 'beds.R1.clinicalCrib.pathology' : 'beds.R1.pathology';
    const replaced = structuredClone(day);
    const slot = kind === 'crib' ? replaced.beds.R1.clinicalCrib! : replaced.beds.R1;
    if (kind === 'move') replaced.beds.R2 = { ...slot, bedId: 'R2' };
    Object.assign(slot, {
      patientName: 'Y SINTETICO',
      rut: '10.000.013-K',
      clinicalEpisodeId: 'ep_Y',
      pathology: 'OBSERVACION',
    });
    const a = await refusedBeforeThisBuild(
      day,
      { [path]: 'OBSERVACION' } as DailyRecordPatch,
      async () => {
        await admin.doc(dayPath).set(replaced);
      }
    );
    // A sync already brought the replacement to this computer.
    await hospitalDB.dailyRecords.put(await server());
    const before = await stored();

    await drain();

    expect((await tasks())[0]).toEqual({ ...a, projectionReleased: true });
    expect(await stored()).toEqual(before);
    offline();
    const reopened = (await getForDateWithMeta(closedDay, false)).record;
    const shownSlot = kind === 'crib' ? reopened?.beds.R1.clinicalCrib : reopened?.beds.R1;
    expect(shownSlot).toMatchObject({ patientName: 'Y SINTETICO', pathology: 'OBSERVACION' });
    if (kind === 'move') expect(reopened?.beds.R2).toEqual((await server()).beds.R2);
  },
  60_000
);

// Recheck finding 2: another computer corrected the refused diagnosis on the server while a note
// of this person still waits. The read publishes that correction with the pending note.
it('shows the server’s correction with the pending note, confirmed, while the note still waits', async () => {
  const c = await census();
  offline();
  await c.edit('diagnosis');
  const [a] = await tasks();
  await hospitalDB.syncQueue.update(a.id!, {
    status: 'PROCESSING',
    attemptId: 'synthetic-attempt',
    leaseOwner: 'synthetic-worker',
    leaseUntil: Date.now() + 60_000,
  });
  await c.edit('note');
  const b = (await tasks()).find(task => task.id !== a.id)!;
  await hospitalDB.syncQueue.update(b.id!, { nextAttemptAt: Date.now() + 86_400_000 });
  await hospitalDB.syncQueue.update(a.id!, {
    status: 'PENDING',
    nextAttemptAt: 0,
    preOutboxHoldUntil: 0,
    attemptId: undefined,
    leaseOwner: undefined,
  });
  c.live();
  // The refusal comes back while another computer corrects that diagnosis on the server.
  const update = hospitalDB.syncQueue.update.bind(hospitalDB.syncQueue);
  const noRelease = vi
    .spyOn(hospitalDB.syncQueue, 'update')
    .mockImplementation(((key: number, changes: object) =>
      'projectionReleased' in changes
        ? Promise.reject(new Error('synthetic release later'))
        : update(key, changes)) as unknown as typeof hospitalDB.syncQueue.update);
  try {
    await drain();
  } finally {
    noRelease.mockRestore();
  }
  expect(await hospitalDB.syncQueue.get(a.id!)).toMatchObject({ status: 'FAILED' });
  await admin
    .doc(dayPath)
    .update({ 'beds.R1.pathology': CORRECTION, lastUpdated: Timestamp.now() });
  await drain();
  await settled();

  expect(await hospitalDB.syncQueue.get(a.id!)).toMatchObject({
    status: 'FAILED',
    projectionReleased: true,
  });
  expect(await hospitalDB.syncQueue.get(b.id!)).toMatchObject({ status: 'PENDING' });
  const read = await getForDateWithMeta(closedDay);
  expect(read.record?.beds.R1.pathology).toBe(CORRECTION);
  expect(read.record?.[night]).toBe(NOTE);
  expect(read.serverConfirmed).toBe(true);
  await waitFor(() => expect(shown()?.beds.R1.pathology).toBe(CORRECTION));
  expect(shown()?.[night]).toBe(NOTE);
  expect((await stored())?.beds.R1.pathology).toBe(CORRECTION);
  // No task changed, and the note still publishes only its own change.
  expect((await hospitalDB.syncQueue.get(a.id!))?.payload).toMatchObject({
    beds: { R1: { pathology: DIAGNOSIS } },
  });
  actAs('admin');
  await hospitalDB.syncQueue.update(b.id!, { nextAttemptAt: 0, preOutboxHoldUntil: 0 });
  await drain();
  expect(await server()).toMatchObject({ [night]: NOTE, beds: { R1: { pathology: CORRECTION } } });
}, 60_000);

// Recheck finding 3 (this unit's part): the server changed the field before refusing, and the
// read after the release fails. The stored copy keeps its stale value, never as confirmed.
it.each(['offline', 'denied'] as const)(
  'never confirms a stale copy when the read after the release is %s, and adopts the server later',
  async mode => {
    const a = await refusedBeforeThisBuild(
      base(closedDay),
      { 'beds.R1.pathology': DIAGNOSIS },
      async () => {
        await admin
          .doc(dayPath)
          .update({ 'beds.R1.pathology': CORRECTION, lastUpdated: Timestamp.now() });
      }
    );
    const authorized = h.db;
    const broken =
      mode === 'offline'
        ? env.authenticatedContext('isolated', { role: 'nurse_hospital' }).firestore()
        : env.unauthenticatedContext().firestore();
    if (mode === 'offline') await disableNetwork(broken);
    h.db = broken;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
      </QueryClientProvider>
    );
    const query = renderHook(() => useDailyRecordQuery(closedDay, false, 'ready'), { wrapper });
    await waitFor(() => expect(query.result.current.isFetched).toBe(true), { timeout: 15_000 });
    await drain();
    await settled();

    expect((await tasks())[0]).toEqual({ ...a, projectionReleased: true });
    await waitFor(() => expect(query.result.current.data).toBeTruthy());
    expect(query.result.current.runtime?.serverConfirmed).toBe(false);
    expect((await getForDateWithMeta(closedDay)).serverConfirmed).toBe(false);

    h.db = authorized;
    await act(async () => {
      await query.result.current.refetch();
    });
    await waitFor(() => expect(query.result.current.data?.beds.R1.pathology).toBe(CORRECTION));
    expect(query.result.current.runtime?.serverConfirmed).toBe(true);
    query.unmount();
  },
  60_000
);

// Recheck finding 4: another tab admitted this person on the shared key while this tab is someone
// else's. Nothing is released: the task, the day and its overlays stay as they are.
it.each([
  ['the account and this tab’s owner are someone else', 'synthetic-B', 'user:synthetic-B'],
  ['only this tab’s admitted owner is someone else', 'synthetic-N', 'user:synthetic-B'],
  ['only the signed-in account is someone else', 'synthetic-B', AUTHOR],
])(
  'releases nothing when %s than the shared key and the task',
  async (_case, uid, admitted) => {
    const a = await refusedBeforeThisBuild(base(closedDay), { [night]: NOTE });
    const day = await stored();
    actAs('nurse_hospital', uid);
    // This tab admitted `admitted`; the shared key names the task's owner (another tab admitted it).
    setSessionGeneration('synthetic-other-tab', admitted);
    localStorage.setItem(SESSION_OWNER_KEY, AUTHOR);
    let notices = 0;
    const count = (event: Event) => {
      if ((event as CustomEvent).detail.operation === 'release') notices++;
    };
    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, count);
    try {
      await drain();
    } finally {
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, count);
    }
    expect(await hospitalDB.syncQueue.get(a.id!)).toEqual(a);
    expect(await stored()).toEqual(day);
    expect(notices).toBe(0);
  },
  60_000
);

it('releases a send stopped before this build only for a nurse session, and no other task', async () => {
  const a = await refusedBeforeThisBuild(base(closedDay), { [night]: NOTE });
  const others: SyncTask[] = [
    { ...a, id: undefined, opId: 'synthetic-foreign', ownerKey: ADMIN },
    { ...a, id: undefined, opId: 'synthetic-conflict', status: 'CONFLICT' },
    { ...a, id: undefined, opId: 'synthetic-logout', lastErrorCode: 'session_owner_logged_out' },
    { ...a, id: undefined, opId: 'synthetic-patient', type: 'UPDATE_PATIENT' },
  ];
  const ids = (await hospitalDB.syncQueue.bulkAdd(others, { allKeys: true })) as number[];
  for (const role of ['admin', 'viewer']) {
    h.role = role;
    await drain();
    expect(await hospitalDB.syncQueue.get(a.id!)).toEqual(a);
  }
  h.role = 'nurse_hospital';
  await drain();
  expect(await hospitalDB.syncQueue.get(a.id!)).toEqual({ ...a, projectionReleased: true });
  for (const [index, id] of ids.entries())
    expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...others[index], id });
}, 60_000);

// Outside this change, said in SAVE-04: a whole-day send has no list of paths. Released, it shows
// the server once a read works; offline the stored copy stays, unconfirmed.
it('shows the server for a released whole-day send once the read works, unconfirmed before', async () => {
  const day = base(closedDay);
  await admin.doc(dayPath).set(day);
  await hospitalDB.dailyRecords.put(day);
  offline();
  await saveDetailed({ ...day, [night]: NOTE }, day.lastUpdated, {
    baseRecord: day,
    authoringSession: captureAuthoringSession(),
  });
  expect((await tasks())[0].syncContract?.changedPaths).toEqual(['*']);
  setFirestoreEnabled(true);
  await sendLater();
  expect((await tasks())[0]).toMatchObject({ status: 'FAILED', projectionReleased: true });
  offline();
  const cold = await getForDateWithMeta(closedDay, false);
  expect(cold.serverConfirmed).toBe(false);
  setFirestoreEnabled(true);
  const warm = await getForDateWithMeta(closedDay);
  expect(warm.record?.[night]).toBe('NOCHE BASE');
  expect(warm.serverConfirmed).toBe(true);
}, 60_000);

// Recheck 2: one rule for any day pending writes hold. A confirmed read shows the server's day
// with the pending paths on top, with or without a released send (after «Descartar envío» too,
// and for a second correction); when they cannot be put on top (a whole-day write, a replaced or
// moved patient, another newborn or mother) the stored copy stays and is never confirmed.
it.each([
  'discard',
  'later-correction',
  'star',
  'replace',
  'move',
  'crib',
  'mother',
  'ordinary',
  'foreign',
] as const)(
  'independent online publication and next read, %s',
  async kind => {
    const day = base(closedDay);
    const rnX = {
      ...day.beds.R1,
      patientName: 'RN X',
      rut: '11111111-1',
      clinicalEpisodeId: 'RN-X',
      pathology: 'TEXTO IGUAL',
    };
    day.beds.R1.clinicalCrib = rnX;
    const remote = structuredClone(day);
    const newPatient = {
      ...day.beds.R1,
      patientName: 'MADRE Y',
      clinicalEpisodeId: 'M-Y',
      rut: '14000000-K',
      pathology: 'TEXTO IGUAL',
    };
    if (kind === 'replace' || kind === 'move' || kind === 'mother') remote.beds.R1 = newPatient;
    if (kind === 'move') remote.beds.R2 = { ...day.beds.R1, bedId: 'R2' };
    if (kind === 'crib')
      remote.beds.R1.clinicalCrib = {
        ...rnX,
        patientName: 'RN Y',
        clinicalEpisodeId: 'RN-Y',
        rut: '10000013-K',
      };
    remote.handoffNovedadesNightShift = CORRECTION;
    // Independent reference read of the same remote bytes before creating either task.
    await admin.doc(dayPath).set(remote);
    const reference = (await getForDateWithMeta(closedDay)).record!;
    expect(reference[night]).toBe(CORRECTION);
    const a = await refusedBeforeThisBuild(day, { [night]: NOTE });
    const local = (await stored())!;
    // Keep separate opIds, as when B was authored while the original request for A was in flight.
    await hospitalDB.syncQueue.update(a.id!, {
      status: 'PROCESSING',
      attemptId: 'review-A',
      leaseOwner: 'fixture',
      leaseUntil: Date.now() + 60000,
    });
    const path =
      kind === 'crib' || kind === 'mother'
        ? 'beds.R1.clinicalCrib.pathology'
        : kind === 'replace' || kind === 'move'
          ? 'beds.R1.pathology'
          : 'handoffNovedadesDayShift';
    const patch = { [path]: 'EDICION PENDIENTE B' } as DailyRecordPatch;
    const payload = applyPatches(local, patch);
    if (kind === 'star') {
      offline();
      await saveDetailed(payload, local.lastUpdated, {
        baseRecord: local,
        authoringSession: captureAuthoringSession(),
      });
      setFirestoreEnabled(true);
    } else {
      expect(
        await queueDailyRecordSyncTaskWithLocalRecord(
          payload,
          { syncContract: { changedPaths: [path], expectedVersion: local.lastUpdated } },
          {
            deferProcessing: true,
            authoringSession: captureAuthoringSession(),
            patchWrite: { patch, baseRecord: local, prepare: applyPatches },
          }
        )
      ).toMatchObject({ accepted: true });
    }
    const b = (await tasks()).find(t => t.id !== a.id)!;
    expect(b.status).toBe('PENDING');
    if (kind === 'star') expect(b.syncContract?.changedPaths).toEqual(['*']);
    await hospitalDB.syncQueue.update(b.id!, {
      nextAttemptAt: Date.now() + 86400000,
      ...(kind === 'foreign' ? { ownerKey: ADMIN } : {}),
    });
    await hospitalDB.syncQueue.put(a);
    await admin.doc(dayPath).set(remote);
    const row = await stored();
    await drain();
    expect(await hospitalDB.syncQueue.get(a.id!)).toEqual({ ...a, projectionReleased: true });
    expect(await stored()).toEqual(row);
    if (kind === 'later-correction') {
      const initial = await getForDateWithMeta(closedDay);
      expect(initial.record?.[night]).toBe(CORRECTION);
      expect(initial.record?.handoffNovedadesDayShift).toBe('EDICION PENDIENTE B');
    }
    if (kind === 'discard' || kind === 'later-correction') {
      const review = await reviewBlockedDailyRecordTask(a.id!);
      expect(await retireReviewedDailyRecordTask(review!)).toBe(true);
    }
    if (kind === 'later-correction') {
      await admin
        .doc(dayPath)
        .update({ [night]: 'SEGUNDA CORRECCION', lastUpdated: Timestamp.now() });
    }
    const attempts = vi.spyOn(rebase, 'overlayPendingDailyRecordWrite');
    const first = await getForDateWithMeta(closedDay);
    const second = await getForDateWithMeta(closedDay, true);
    const count = attempts.mock.calls.length;
    const repeated = await getForDateWithMeta(closedDay);
    const triedAgain = attempts.mock.calls.length > count;
    attempts.mockRestore();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <DefaultRepositoryProvider>{children}</DefaultRepositoryProvider>
      </QueryClientProvider>
    );
    const q = renderHook(() => useDailyRecordQuery(closedDay, false, 'ready'), { wrapper });
    await waitFor(() => expect(q.result.current.data).toBeTruthy(), { timeout: 12000 });
    await settled();
    const ui = {
      value: q.result.current.data?.[night],
      confirmed: q.result.current.runtime?.serverConfirmed,
    };
    q.unmount();
    const possible =
      kind === 'later-correction' ||
      kind === 'discard' ||
      kind === 'ordinary' ||
      kind === 'foreign';
    expect(triedAgain).toBe(true);
    expect((await tasks()).find(t => t.id === b.id)).toMatchObject({
      status: 'PENDING',
      payload: b.payload,
    });
    if (possible) {
      const expectedNote = kind === 'later-correction' ? 'SEGUNDA CORRECCION' : CORRECTION;
      expect(first.record?.[night]).toBe(expectedNote);
      expect(first.record).toEqual({
        ...applyPatches(reference, patch),
        [night]: expectedNote,
        lastUpdated: row!.lastUpdated,
      });
      expect(first.serverConfirmed).toBe(true);
      expect(ui).toEqual({ value: expectedNote, confirmed: true });
      return;
    }
    expect(first.record).toEqual(row);
    expect(await stored()).toEqual(row);
    if (kind !== 'star') {
      // A subsequent correction makes the same holder composable. Nothing in the queue changes.
      await admin.doc(dayPath).set({ ...day, [night]: CORRECTION });
      const next = await getForDateWithMeta(closedDay);
      expect(next.record?.[night]).toBe(CORRECTION);
      expect(next.serverConfirmed).toBe(true);
    }
    expect({
      point: first.serverConfirmed,
      sync: second?.serverConfirmed,
      again: repeated.serverConfirmed,
      ui: ui.confirmed,
    }).toEqual({ point: false, sync: false, again: false, ui: false });
  },
  60000
);

// The same rule with no refusal at all: on today's census another person corrects a field while
// this computer still has an unsent edit of another field of the same day.
it('shows another person’s correction with this computer’s pending edit, confirmed, with no refusal', async () => {
  const day = base(today);
  const todayPath = `hospitals/hanga_roa/dailyRecords/${today}`;
  await admin.doc(todayPath).set(day);
  await hospitalDB.dailyRecords.put(day);
  offline();
  const patch = { [night]: NOTE } as DailyRecordPatch;
  expect(
    await queueDailyRecordSyncTaskWithLocalRecord(
      applyPatches(day, patch),
      { syncContract: { changedPaths: [night], expectedVersion: day.lastUpdated } },
      {
        deferProcessing: true,
        authoringSession: captureAuthoringSession(),
        patchWrite: { patch, baseRecord: day, prepare: applyPatches },
      }
    )
  ).toMatchObject({ accepted: true });
  setFirestoreEnabled(true);
  await admin
    .doc(todayPath)
    .update({ handoffNovedadesDayShift: CORRECTION, lastUpdated: Timestamp.now() });

  const read = await getForDateWithMeta(today);
  const synced = await getForDateWithMeta(today, true);

  expect(read.record?.handoffNovedadesDayShift).toBe(CORRECTION);
  expect(read.record?.[night]).toBe(NOTE);
  expect(read.serverConfirmed).toBe(true);
  expect(synced?.record?.handoffNovedadesDayShift).toBe(CORRECTION);
  expect(synced?.serverConfirmed).toBe(true);
  const [pending] = await tasks();
  expect(pending).toMatchObject({ status: 'PENDING' });
  expect((pending.payload as DailyRecord)[night]).toBe(NOTE);
  expect((await admin.doc(todayPath).get()).data()?.[night]).toBe('NOCHE BASE');
}, 60_000);
