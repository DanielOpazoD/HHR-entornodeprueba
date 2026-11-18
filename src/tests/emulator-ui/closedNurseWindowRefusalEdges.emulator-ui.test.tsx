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
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import {
  applyPendingExplicitCensusPatch,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import { buildSyncQueueStats } from '@/hooks/controllers/syncQueueMonitorController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import {
  getSyncQueueTelemetry,
  listRecentSyncQueueOperations,
  processSyncQueue,
  queueSyncTask,
  retryQuarantinedSyncTask,
} from '@/services/storage/sync';
import { resumeOwnedNursingHandoff } from '@/services/storage/sync/nursingHandoffSession';
import { holdsDailyRecordProjection } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import * as exporter from '@/services/exporters/exportDownload';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { addCalendarDays } from '@/utils/clinicalDateUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

/**
 * The independent review of W14-H1B (evidence/W14/H1B/review): the edges where «lo que se ve
 * siempre es la información vigente» first failed. A refused send gives its fields back to this
 * computer's copy of the day instead of dropping the whole day; its unconfirmed overlay goes with
 * them; other pending writes keep theirs; the administrator keeps the retry; a clock that was
 * behind is caught on the next queue pass; and a read that fails after the release still has the
 * day without the refused field. Real rules, the shipped authority handler, the emulator.
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
vi.mock('@/firebaseConfig', () => ({
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

const projectId = 'demo-hhr-closed-window-edges';
const AUTHOR = 'user:synthetic-N';
const ADMIN = 'user:synthetic-admin';
const NOTE = 'NOTA ESCRITA SIN RED';
const DIAGNOSIS = 'DIAGNOSTICO ESCRITO SIN RED';
const CORRECTION = 'CORRECCION DE OTRO EQUIPO';
const night = 'handoffNovedadesNightShift';
const today = getTodayISO();
const closedDay = addCalendarDays(today, -2);
const dayPath = `hospitals/hanga_roa/dailyRecords/${closedDay}`;
const closesAt = clinicalWallClockToDate(closedDay, '00:00').getTime() + 48 * 3_600_000;

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
  app = initializeApp({ projectId }, 'closed-window-edges');
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

/** A first send `a` already claimed while the person writes a second one, `b`, on the same day. */
const twoSends = async (c: Awaited<ReturnType<typeof census>>, first: Field, second: Field) => {
  offline();
  await c.edit(first);
  const [a] = await tasks();
  await hospitalDB.syncQueue.update(a.id!, {
    status: 'PROCESSING',
    leaseUntil: Date.now() + 60_000,
    attemptId: 'synthetic-attempt',
    leaseOwner: 'synthetic-worker',
  });
  await c.edit(second);
  const b = (await tasks()).find(task => task.id !== a.id)!;
  expect(b.status).toBe('PENDING');
  // b waits (a retry later); a is sent now.
  await hospitalDB.syncQueue.update(b.id!, { nextAttemptAt: Date.now() + 86_400_000 });
  await hospitalDB.syncQueue.update(a.id!, {
    status: 'PENDING',
    nextAttemptAt: 0,
    leaseOwner: undefined,
    attemptId: undefined,
  });
  c.live();
  await sendLater();
  await settled();
  expect((await hospitalDB.syncQueue.get(a.id!))?.projectionReleased).toBe(true);
  expect((await hospitalDB.syncQueue.get(b.id!))?.status).toBe('PENDING');
  return { a, b };
};

// Review finding 1: the send leaves 30 s after the edit, while its overlay is still current.
it('shows the base and then the other computer’s correction of the same field, never the refused value', async () => {
  const c = await census();
  const spy = vi.spyOn(Date, 'now').mockReturnValue(closesAt - 15_000);
  try {
    offline();
    await c.edit('diagnosis');
    spy.mockReturnValue(closesAt + 15_000);
    c.live();
    await drain();
    await settled();
    expect((await tasks())[0].projectionReleased).toBe(true);
    await waitFor(() => expect(shown()?.beds.R1.pathology).toBe('DIAGNOSTICO BASE'));

    await admin.doc(dayPath).update({
      'beds.R1.pathology': CORRECTION,
      handoffNovedadesDayShift: 'MARCA',
      lastUpdated: Timestamp.now(),
    });
    await waitFor(() => expect(shown()?.handoffNovedadesDayShift).toBe('MARCA'));
    expect(shown()?.beds.R1.pathology).toBe(CORRECTION);
    expect((await stored())?.beds.R1.pathology).toBe(CORRECTION);
  } finally {
    spy.mockRestore();
  }
}, 60_000);

it('keeps the overlay of an independent field when another field’s send is released', async () => {
  const c = await census();
  offline();
  await c.edit('note');
  c.live();
  const clear = registerPendingDailyRecordPatch(closedDay, { 'beds.R1.pathology': 'PARCHE B' });
  try {
    // Sent at once, so the overlay is still current when the note is released.
    const [a] = await tasks();
    await hospitalDB.syncQueue.update(a.id!, { nextAttemptAt: 0, preOutboxHoldUntil: 0 });
    await drain();
    await settled();
    expect((await tasks())[0].projectionReleased).toBe(true);
    const remote = await server();
    expect(applyPendingExplicitCensusPatch(closedDay, remote, remote).beds.R1.pathology).toBe(
      'PARCHE B'
    );
  } finally {
    clear();
  }
}, 60_000);

// Review finding 2: another send still holds the day while the first one is refused.
it.each([false, true])(
  'shows the current value of the refused field and the other pending edit, which publishes only its change (other account: %s)',
  async foreign => {
    const c = await census();
    const { a, b } = await twoSends(c, 'diagnosis', 'note');
    if (foreign) await hospitalDB.syncQueue.update(b.id!, { ownerKey: ADMIN });
    await waitFor(() => expect(shown()?.beds.R1.pathology).toBe('DIAGNOSTICO BASE'));
    expect(shown()?.[night]).toBe(NOTE);
    expect((await stored())?.beds.R1.pathology).toBe('DIAGNOSTICO BASE');
    expect((await getForDateWithMeta(closedDay)).record?.beds.R1.pathology).toBe(
      'DIAGNOSTICO BASE'
    );

    // b goes out under a role allowed to write the closed day: only its own change is published.
    if (foreign) {
      c.hook.unmount();
      actAs('admin', 'synthetic-admin');
      await reconcileAuthorizedSessionOwner(ADMIN);
      await resumeOwnedNursingHandoff(ADMIN);
    }
    actAs('admin');
    await hospitalDB.syncQueue.update(b.id!, { nextAttemptAt: 0, preOutboxHoldUntil: 0 });
    await drain();
    expect((await server())[night]).toBe(NOTE);
    expect((await server()).beds.R1.pathology).toBe('DIAGNOSTICO BASE');
    expect(await hospitalDB.syncQueue.get(a.id!)).toMatchObject({
      status: 'FAILED',
      ownerKey: AUTHOR,
    });
    expect((await hospitalDB.syncQueue.get(a.id!))?.payload).toMatchObject({
      beds: { R1: { pathology: DIAGNOSIS } },
    });
  },
  60_000
);

it('reads the current note while a pending diagnosis of the same day still waits', async () => {
  const c = await census();
  await twoSends(c, 'note', 'diagnosis');
  const read = await getForDateWithMeta(closedDay);
  expect(read.record?.[night]).toBe('NOCHE BASE');
  expect(read.record?.beds.R1.pathology).toBe(DIAGNOSIS);
  await waitFor(() => expect(shown()?.[night]).toBe('NOCHE BASE'));
  expect(shown()?.beds.R1.pathology).toBe(DIAGNOSIS);
}, 60_000);

// Review finding 3: a refusal of the administrator has nothing to do with the nurse window.
it('keeps the administrator’s retry after a refusal unrelated to the window', async () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const denying = rules.replace(
    'allow update: if canUpdatePersistedDailyRecord()',
    'allow update: if false && canUpdatePersistedDailyRecord()'
  );
  expect(denying).not.toBe(rules);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  const loadRules = async (text: string) => {
    const loader = await initializeTestEnvironment({
      projectId,
      firestore: { host, port: Number(port), rules: text },
    });
    await loader.cleanup();
  };
  actAs('admin');
  const c = await census();
  offline();
  await c.edit('note');
  try {
    await loadRules(denying);
    c.live();
    await sendLater();
    await settled();
  } finally {
    await loadRules(rules);
  }
  const [a] = await tasks();
  expect(a.lastErrorCode).toMatch(/permission-denied$/);
  expect(a.projectionReleased).toBeUndefined();
  expect(await retryQuarantinedSyncTask(a.id!)).toBe(true);
}, 60_000);

// Review finding 4: this computer's clock was behind when the server refused.
it('shows the current day once the clock is right, on the next queue pass', async () => {
  const c = await census();
  offline();
  await c.edit('note');
  const [a] = await tasks();
  await hospitalDB.syncQueue.update(a.id!, { nextAttemptAt: 0, preOutboxHoldUntil: 0 });
  c.live();
  const behind = vi.spyOn(Date, 'now').mockReturnValue(closesAt - 3_600_000);
  try {
    await drain();
  } finally {
    behind.mockRestore();
  }
  expect((await tasks())[0]).toMatchObject({ status: 'FAILED' });
  expect((await tasks())[0].projectionReleased).toBeUndefined();

  await drain();
  await settled();
  c.hook.unmount();
  expect((await tasks())[0]).toMatchObject({ status: 'FAILED', projectionReleased: true });
  expect((await getForDateWithMeta(closedDay)).record?.[night]).toBe('NOCHE BASE');
}, 60_000);

// Review finding 5 and recheck finding 3: the read right after the release fails. Nothing is
// written on the day at the release, so this computer keeps its copy as it is, possibly with the
// refused text, and never presents it as confirmed (SAVE-01); the next good read shows the server.
it.each(['denied', 'offline'] as const)(
  'keeps this computer’s copy unconfirmed when the read after the release is %s',
  async mode => {
    const c = await census();
    offline();
    await c.edit('note');
    const authorized = h.db;
    const broken =
      mode === 'offline'
        ? env.authenticatedContext('offline-client', { role: 'nurse_hospital' }).firestore()
        : env.unauthenticatedContext().firestore();
    if (mode === 'offline') await disableNetwork(broken);
    let released = false;
    const cut = (event: Event) => {
      if ((event as CustomEvent).detail.operation !== 'release') return;
      released = true;
      h.db = broken;
    };
    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, cut, true);
    try {
      c.live();
      await sendLater();
      await settled();
      expect(released).toBe(true);
      expect((await tasks())[0]).toMatchObject({ status: 'FAILED', projectionReleased: true });
      // The day is still there, whole; what it shows is not confirmed by the server.
      const read = await getForDateWithMeta(closedDay);
      expect(read.record?.handoffNovedadesDayShift).toBe('DIA BASE');
      expect(read.serverConfirmed).toBe(false);
      await waitFor(() =>
        expect(
          client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(closedDay))?.runtime
            .serverConfirmed
        ).toBe(false)
      );
      c.hook.unmount();
      offline();
      const reopened = await getForDateWithMeta(closedDay, false);
      expect(reopened.record?.handoffNovedadesDayShift).toBe('DIA BASE');
      expect(reopened.serverConfirmed).toBe(false);
      // Back with a working read: the server's day, confirmed.
      h.db = authorized;
      setFirestoreEnabled(true);
      const recovered = await getForDateWithMeta(closedDay);
      expect(recovered.record?.[night]).toBe('NOCHE BASE');
      expect(recovered.serverConfirmed).toBe(true);
    } finally {
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, cut, true);
    }
  },
  60_000
);

it('keeps the stored day of a send that never wrote it (queued on its own)', async () => {
  const c = await census();
  c.hook.unmount();
  const day = await server();
  expect(
    await queueSyncTask(
      'UPDATE_DAILY_RECORD',
      { ...day, [night]: NOTE },
      { syncContract: { changedPaths: [night], expectedVersion: day.lastUpdated } },
      { deferProcessing: true }
    )
  ).toMatchObject({ accepted: true });
  expect((await stored())?.[night]).toBe(day[night]);
  await drain();
  expect((await tasks())[0]).toMatchObject({ status: 'FAILED', projectionReleased: true });
  expect((await stored())?.[night]).toBe(day[night]);
}, 60_000);

it('commits the release whole or not at all, as another connection sees it', async () => {
  const c = await census();
  offline();
  await c.edit('note');
  c.live();
  const other = new HangaRoaDatabase();
  await other.open();
  let notices = 0;
  const count = (event: Event) => {
    if ((event as CustomEvent).detail.operation === 'release') notices++;
  };
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, count);
  const update = hospitalDB.syncQueue.update.bind(hospitalDB.syncQueue);
  const put = vi
    .spyOn(hospitalDB.syncQueue, 'update')
    .mockImplementation(((key: number, changes: object) =>
      'projectionReleased' in changes
        ? Promise.reject(new Error('abort'))
        : update(key, changes)) as unknown as typeof hospitalDB.syncQueue.update);
  try {
    await sendLater();
    put.mockRestore();
    const [a] = await other.syncQueue.toArray();
    expect(a).toMatchObject({ status: 'FAILED' });
    expect(a.projectionReleased).toBeUndefined();
    expect((await other.dailyRecords.get(closedDay))?.[night]).toBe(NOTE);
    expect(notices).toBe(0);

    await drain();
    await settled();
    const [released] = await other.syncQueue.toArray();
    expect(holdsDailyRecordProjection(released, closedDay)).toBe(false);
    expect((released.payload as DailyRecord)[night]).toBe(NOTE);
    expect(notices).toBe(1);
    await waitFor(async () =>
      expect((await other.dailyRecords.get(closedDay))?.[night]).toBe('NOCHE BASE')
    );
  } finally {
    put.mockRestore();
    other.close();
    window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, count);
  }
}, 60_000);

it('downloads the refused note from «Descartar envío» and keeps the send', async () => {
  const c = await census();
  offline();
  await c.edit('note');
  c.live();
  await sendLater();
  await settled();
  const download = vi.spyOn(exporter, 'downloadBlob').mockImplementation(() => {});
  const view = render(
    <RayenSyncQueueDetails
      stats={buildSyncQueueStats(await getSyncQueueTelemetry())}
      operations={await listRecentSyncQueueOperations(5)}
      refresh={async () => {}}
      working={false}
    />
  );
  try {
    fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar envío' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar copia para revisar' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob] = download.mock.calls[0];
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob as Blob);
    });
    const exported = JSON.parse(text);
    expect(exported.task.payload[night]).toBe(NOTE);
    expect(exported.remotelyConfirmed).toBe(false);
    expect((await tasks())[0].status).toBe('FAILED');
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  } finally {
    download.mockRestore();
    view.unmount();
  }
}, 60_000);

it('keeps the handoff another account left unsent here, and publishes it when that account returns', async () => {
  actAs('admin', 'synthetic-admin');
  await reconcileAuthorizedSessionOwner(ADMIN);
  const first = await census();
  offline();
  await first.edit('note');
  const [handoff] = await tasks();
  expect(handoff.ownerKey).toBe(ADMIN);
  first.hook.unmount();
  client.clear();
  client.unmount();

  actAs('nurse_hospital', 'synthetic-N');
  await reconcileAuthorizedSessionOwner(AUTHOR);
  setFirestoreEnabled(true);
  const second = await census();
  offline();
  await second.edit('diagnosis');
  second.live();
  await sendLater();
  await settled();
  expect(((await hospitalDB.syncQueue.get(handoff.id!))?.payload as DailyRecord)[night]).toBe(NOTE);
  expect((await server())[night]).toBe('NOCHE BASE');
  expect(shown()?.[night]).toBe('NOCHE BASE');
  expect(shown()?.beds.R1.pathology).toBe('DIAGNOSTICO BASE');
  second.hook.unmount();
  client.clear();
  client.unmount();

  actAs('admin', 'synthetic-admin');
  await reconcileAuthorizedSessionOwner(ADMIN);
  await resumeOwnedNursingHandoff(ADMIN);
  await drain();
  expect((await server())[night]).toBe(NOTE);
  expect((await server()).beds.R1.pathology).toBe('DIAGNOSTICO BASE');
  expect((await getForDateWithMeta(closedDay)).record?.beds.R1.pathology).toBe('DIAGNOSTICO BASE');
  expect(await hospitalDB.syncQueue.get(handoff.id!)).toBeUndefined();
}, 60_000);
