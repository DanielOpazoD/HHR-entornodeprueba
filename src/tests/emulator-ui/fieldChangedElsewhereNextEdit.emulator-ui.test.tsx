/* @flake-safe: Synthetic census on the current clinical day, which the real rules let nurses write. */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/context/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { buildClinicalCribPatch } from '@/hooks/controllers/clinicalCribController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { usePatientMovementCreationExecutor } from '@/features/census/hooks/usePatientMovementExecutors';
import {
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/features/census/controllers/patientMovementCreationController';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { BEDS } from '@/constants/beds';
import {
  getSyncQueueTelemetry,
  processSyncQueue,
  retryQuarantinedSyncTask,
} from '@/services/storage/sync';
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayAdmissionUtils';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/session/sessionScopedStorageService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

/**
 * What the census does after «El campo cambió en otro equipo» (W12-CW5): the screen keeps this
 * computer's text, and the person's next edit of that field must again meet the other computer's
 * text instead of replacing it unseen. The edits run through the census hook, whose base is the
 * record on screen, against the real rules, the shipped authority handler and the Firestore
 * emulator.
 */
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({
  db: undefined as unknown,
}));
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
      uid: 'synthetic-B',
      email: 'synthetic-B@example.invalid',
      isAnonymous: false,
      getIdTokenResult: async () => ({
        claims: { role: 'nurse_hospital' },
      }),
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

// The current clinical day (yesterday before rollover).
const date = resolveCurrentClinicalDay();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-field-changed-elsewhere';
const night = 'handoffNovedadesNightShift';
const base = (): DailyRecord =>
  JSON.parse(
    JSON.stringify(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: new Date(Date.now() - 60_000).toISOString(),
        dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
        handoffNovedadesDayShift: 'DIA BASE',
        handoffNovedadesNightShift: 'NOCHE BASE',
        activeExtraBeds: [],
        beds: {
          R4: DataFactory.createMockPatient('R4', {
            patientName: 'PACIENTE SINTETICO A',
            rut: '11111111-1',
            clinicalEpisodeId: 'episode-a',
            admissionDate: date,
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
const shown = () =>
  client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date)) as
    | DailyRecordQueryResult
    | undefined;

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'field-changed-elsewhere');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  h.db = env
    .authenticatedContext('synthetic-B', {
      role: 'nurse_hospital',
      email: 'synthetic-B@example.invalid',
    })
    .firestore();
  setFirestoreEnabled(true);
  // The queue runs only when a test says so (`replay`), so each step meets the queue as the last
  // one left it. One test below runs it as the app does, woken by every save (W12-CW11).
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const context = () => ({
    auth: { uid: 'synthetic-B', token: { email: 'synthetic-B@example.invalid' } },
  });
  // Only the callable transport is replaced: the shipped handlers run their real transactions.
  const authorityApi = createDailyRecordWriteAuthorityFunctions({
    firestore: admin,
    Timestamp,
    resolveRoleForEmail: async () => 'nurse_hospital',
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
afterEach(async () => {
  client?.clear();
  client?.unmount();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await deleteApp(app);
});

/** The census on this computer and its hook, over the server's day (`seed` shapes that day). */
const censusHere = async (seed?: (day: DailyRecord) => void) => {
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
  // One day, so this computer starts on the server's exact version.
  const day = base();
  seed?.(day);
  await admin.doc(dayPath).set(day);
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
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
    { wrapper, initialProps: { live: false } }
  );
  const mutate = async (partial: DailyRecordPatch, options?: object) => {
    let payload: { result?: DailyRecordWriteResult } = {};
    await act(async () => {
      payload = (await hook.result.current.mutateAsync({
        date,
        partial,
        options,
      } as never)) as typeof payload;
    });
    return payload.result;
  };
  const edit = (field: 'handoffNovedadesDayShift' | typeof night, value: string) =>
    mutate({ [field]: value } as DailyRecordPatch);
  return { hook, mutate, edit };
};

/** The census on this computer, its hook, and the other computer's text already on the server. */
const conflictOnNight = async () => {
  const { hook, mutate, edit } = await censusHere();
  // The other computer writes first; this screen has not received it yet.
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
  const first = await edit(night, 'B2');
  expect(first?.state).not.toBe('confirmed');
  expect(first).toMatchObject({ state: 'held', reason: 'field_changed_elsewhere' });
  const second = await edit(night, 'B3');
  expect((await server())[night]).toBe('A1');
  expect(second?.state).not.toBe('confirmed');
  expect(second).toMatchObject({ state: 'held', reason: 'field_changed_elsewhere' });
  return { hook, mutate, edit };
};

/** The latest unsent text replaced this person's earlier one in its write; it stays there until reviewed. */
const expectUnsentNightKept = async (value: string) => {
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(
    tasks.some(
      task => task.status !== 'RETIRED' && (task.payload as Partial<DailyRecord>)?.[night] === value
    )
  ).toBe(true);
};

it('meets the other computer’s text again on the next edit after the notice', async () => {
  const { edit, hook } = await conflictOnNight();
  await expectUnsentNightKept('B3');

  // A field nobody else changed is still saved at once (#1603).
  const day = await edit('handoffNovedadesDayShift', 'B4');
  expect(day?.state).toBe('confirmed');
  expect(await server()).toMatchObject({ handoffNovedadesDayShift: 'B4', [night]: 'A1' });
  hook.unmount();
}, 60_000);

/** The day as a confirmed server read leaves it on screen: live listener, or that plus a refetch. */
const recover = async (hook: Awaited<ReturnType<typeof conflictOnNight>>['hook'], mode: string) => {
  hook.rerender({ live: true });
  if (mode === 'refetch')
    await act(async () => {
      await client.refetchQueries({ type: 'active' });
    });
  await waitFor(() => expect(shown()?.runtime?.serverConfirmed).toBe(true), { timeout: 10_000 });
};

it.each(['live', 'refetch'] as const)(
  'keeps the per-field base and the unsent text after a confirmed read of the day (%s)',
  async mode => {
    const { edit, mutate, hook } = await conflictOnNight();
    await recover(hook, mode);

    // The screen keeps the unsent text, never as the server's, under a real version (no marker),
    // and the write that holds it keeps it.
    expect(shown()?.record?.[night]).toBe('B3');
    expect(shown()?.record?.lastUpdated).not.toBe(new Date(0).toISOString());
    await expectUnsentNightKept('B3');

    // Still a field the other computer changed: met again, not replaced.
    const again = await edit(night, 'B5');
    expect(again).toMatchObject({ state: 'held', reason: 'field_changed_elsewhere' });
    expect((await server())[night]).toBe('A1');
    // A field nobody else changed is saved at once.
    expect((await edit('handoffNovedadesDayShift', 'B6'))?.state).toBe('confirmed');

    // A crib re-reads the server's day before it is created, so it is saved over that version.
    const parent = shown()!.record!.beds.R4;
    await mutate(buildClinicalCribPatch('R4', parent), {
      consistency: 'remote_confirmed',
      optimisticRemoteConfirmed: true,
      clinicalCribCreate: {
        bedId: 'R4',
        confirmedLastUpdated: shown()!.record!.lastUpdated,
        confirmedParent: buildConfirmedBedOccupantIdentity(parent),
      },
    });
    expect((await server()).beds.R4.clinicalCrib?.bedId).toBeTruthy();
    expect((await server())[night]).toBe('A1');
    await expectUnsentNightKept('B5');
    hook.unmount();
  },
  60_000
);

// W12-CW10. «Limpiar» on the census row (a bed clear, not a discharge). The day kept here with this
// person's unsent texts carries this computer's time, never a version of the server. The hook binds
// the clear to the server's day, so the bed is cleared while a diagnosis waits after the notice:
// the obsolete diagnosis for the cleared patient is stripped (ID-05) while the night note stays.
it('clears the bed («Limpiar») of a patient whose diagnosis waits after the notice', async () => {
  const { mutate, hook } = await conflictOnNight();
  await admin.doc(dayPath).update({ 'beds.R4.pathology': 'A4', lastUpdated: Timestamp.now() });
  await mutate({ 'beds.R4.pathology': 'B4' } as DailyRecordPatch);
  await recover(hook, 'refetch');

  const record = shown()!.record!;
  const discharge = await mutate(
    bedManagementReducer(record, { type: 'CLEAR_PATIENT', bedId: 'R4' }) as DailyRecordPatch,
    {
      consistency: 'remote_confirmed',
      optimisticRemoteConfirmed: true,
      intentionalBedClear: {
        bedId: 'R4',
        confirmedLastUpdated: record.lastUpdated,
        confirmedOccupant: buildConfirmedBedOccupantIdentity(record.beds.R4),
      },
    }
  );
  expect(discharge?.state).toBe('confirmed');
  expect((await server()).beds.R4).toMatchObject({ rut: '', pathology: '' });
  const held = (await hospitalDB.syncQueue.toArray()).filter(
    task => (task.payload as DailyRecord | undefined)?.beds?.R4?.pathology === 'B4'
  );
  expect(held).toEqual([]);
  await expectUnsentNightKept('B3');
  hook.unmount();
}, 60_000);

/** The queue run as the browser runs it once the network is back, past any retry wait. */
const replay = async () => {
  const now = Date.now;
  for (let round = 1; round <= 3; round++) {
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + round * 10 * 60_000);
    try {
      await processSyncQueue();
    } finally {
      clock.mockRestore();
    }
  }
};

type Movement = 'discharge' | 'transfer';
/** «Dar de alta» or «Traslado» on the census row: its controllers and the census's movement executor. */
const moveOut = async (
  mutate: Awaited<ReturnType<typeof censusHere>>['mutate'],
  kind: Movement
) => {
  const record = shown()!.record!;
  const resolution =
    kind === 'discharge'
      ? resolveAddDischargeMovement({
          record,
          bedId: 'R4',
          payload: {
            status: 'Vivo',
            type: 'Domicilio (Habitual)',
            time: '10:00',
            dischargeTarget: 'both',
          },
          bedsCatalog: BEDS,
          createEmptyPatient,
        })
      : resolveAddTransferMovement({
          record,
          bedId: 'R4',
          payload: {
            evacuationMethod: 'Avión comercial',
            receivingCenter: 'Hospital Salvador',
            receivingCenterOther: '',
            transferEscort: '',
            time: '10:00',
          },
          bedsCatalog: BEDS,
          createEmptyPatient,
        });
  const outcomes: unknown[] = [];
  const executor = renderHook(() =>
    usePatientMovementCreationExecutor({
      saveAndUpdate: async () => {
        throw new Error('the census saves a movement as a patch');
      },
      notifyCreationError: code => outcomes.push(code),
      patchRecord: async patch => {
        outcomes.push(await mutate(patch));
      },
    })
  );
  await act(async () => {
    // Each kind with its own resolution, as usePatientDischarges and usePatientTransfers call it.
    await executor.result.current({
      kind,
      bedId: 'R4',
      baseRecord: record,
      resolution: resolution as Parameters<typeof executor.result.current>[0]['resolution'],
    });
  });
  executor.unmount();
  return outcomes as (DailyRecordWriteResult | undefined)[];
};
const listOf = (kind: Movement) => (kind === 'discharge' ? 'discharges' : 'transfers');
const movedOut = (record: DailyRecord | undefined, kind: Movement) =>
  ((record?.[listOf(kind)] ?? []) as { patientName: string; deleted?: boolean }[])
    .filter(item => !item.deleted)
    .map(item => item.patientName);
/** The queue's tasks, each with what the person would review: its patient and the diagnosis. */
const heldTasks = async () =>
  (await hospitalDB.syncQueue.toArray()).map(task => {
    const bed = (task.payload as DailyRecord).beds.R4;
    return {
      status: task.status,
      patient: [bed.rut, bed.clinicalEpisodeId],
      pathology: bed.pathology,
      paths: task.syncContract?.changedPaths,
    };
  });

// «Dar de alta» / «Traslado» empties the bed and publishes cleanly; any prior offline field edit
// for the departed patient is stripped (ID-05) without leaving a `:detached:` conflict behind.
it.each(['discharge', 'transfer'] as const)(
  '«%s» publishes the movement and strips an obsolete offline diagnosis for the departed patient',
  async kind => {
    const { mutate, hook } = await censusHere();
    setFirestoreEnabled(false);
    await mutate({ 'beds.R4.pathology': 'B4' } as DailyRecordPatch);
    setFirestoreEnabled(true);

    const [saved] = await moveOut(mutate, kind);
    expect(saved).toMatchObject({ state: 'local', cause: 'queue_route' });
    await replay();

    const remote = await server();
    expect(remote.beds.R4).toMatchObject({ rut: '', pathology: '' });
    expect(movedOut(remote, kind)).toEqual(['PACIENTE SINTETICO A']);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    hook.unmount();
  },
  60_000
);

// After a «El campo cambió en otro equipo» conflict on R4, moving the patient out still does not
// clear the other computer's diagnosis unseen (SAVE-02): the movement waits as a single CONFLICT
// without fabricating a second `:detached:` sub-task.
it.each(['discharge', 'transfer'] as const)(
  '«%s» after a diagnosis conflict keeps the movement held without overwriting the other computer',
  async kind => {
    const { mutate, hook } = await censusHere();
    await admin.doc(dayPath).update({ 'beds.R4.pathology': 'A4', lastUpdated: Timestamp.now() });
    await mutate({ 'beds.R4.pathology': 'B4' } as DailyRecordPatch);
    // The browser replays it at once and it is held: «El campo cambió en otro equipo».
    await replay();
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { status: 'CONFLICT', error: expect.stringMatching(/El campo cambió en otro equipo/) },
    ]);
    await recover(hook, 'refetch');

    await moveOut(mutate, kind);
    await replay();

    expect((await server()).beds.R4).toMatchObject({ rut: '11111111-1', pathology: 'A4' });
    const tasks = await heldTasks();
    expect(
      tasks.filter(task => task.paths?.includes(listOf(kind))).map(task => task.status)
    ).toEqual(['CONFLICT']);
    expect((await getSyncQueueTelemetry()).conflict).toBe(1);
    hook.unmount();
  },
  60_000
);

// ID-01: the bed on the server holds another patient; the movement written here for the first one
// never empties it.
it('«Dar de alta» never empties a bed that now holds another patient', async () => {
  const { mutate, hook } = await censusHere();
  await admin.doc(dayPath).update({
    'beds.R4.rut': '12345678-5',
    'beds.R4.patientName': 'PACIENTE SINTETICO C',
    'beds.R4.clinicalEpisodeId': 'episode-c',
    lastUpdated: Timestamp.now(),
  });
  await moveOut(mutate, 'discharge');
  await replay();

  expect((await server()).beds.R4).toMatchObject({
    rut: '12345678-5',
    clinicalEpisodeId: 'episode-c',
  });
  expect(movedOut(await server(), 'discharge')).toEqual([]);
  expect(await heldTasks()).toMatchObject([{ status: 'CONFLICT' }]);
  hook.unmount();
}, 60_000);

/** The browser's queue is idle: nothing claimed, nothing waiting to be sent. */
const queueIdle = () =>
  vi.waitFor(
    async () => {
      const busy = (await hospitalDB.syncQueue.toArray()).some(
        task =>
          task.status === 'PROCESSING' || (task.status === 'PENDING' && !task.preOutboxHoldState)
      );
      if (busy) throw new Error('the queue is still sending');
    },
    { timeout: 20_000, interval: 50 }
  );

// W12-CW11. The queue as the app runs it: every save wakes it, not a test step. A write already
// refused («El campo cambió en otro equipo») used to be stored as pending and sent again at once,
// and so did the held write after a direct save of another field. While that resend was under
// way the person's next edit got a second task, and the review showed the same text twice
// (19 of 20 runs). The refused write is held as that conflict now, and stays so. Twice: the first
// run of a process loads the recovery's modules, and the resend ended before the next edit.
it.each(['first', 'second'])(
  'keeps one held task for the text while the queue runs on its own, as in the app (%s run)',
  async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      const { edit, hook } = await censusHere();
      await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
      expect(await edit(night, 'B2')).toMatchObject({
        state: 'held',
        reason: 'field_changed_elsewhere',
      });
      expect(await edit(night, 'B3')).toMatchObject({
        state: 'held',
        reason: 'field_changed_elsewhere',
      });
      // A field nobody else changed is still saved at once (#1603).
      expect((await edit('handoffNovedadesDayShift', 'B4'))?.state).toBe('confirmed');
      expect(await edit(night, 'B5')).toMatchObject({
        state: 'held',
        reason: 'field_changed_elsewhere',
      });
      await queueIdle();

      expect(await server()).toMatchObject({ handoffNovedadesDayShift: 'B4', [night]: 'A1' });
      expect(
        (await hospitalDB.syncQueue.toArray()).map(task => [
          task.status,
          (task.payload as DailyRecord)[night],
          task.error,
        ])
      ).toEqual([['CONFLICT', 'B5', expect.stringMatching(/El campo cambió en otro equipo/)]]);
      hook.unmount();
    } finally {
      online.mockReturnValue(false);
    }
  },
  60_000
);

// When a queued day write combines a text another computer changed with a movement («Dar de alta»),
// the whole write waits cleanly in CONFLICT without splitting or overwriting the server's text
// (SAVE-02, SAVE-03). Retrying still meets the server's text and keeps both edits intact locally.
it('holds the whole write in CONFLICT when «Dar de alta» is queued with a text changed elsewhere', async () => {
  const { mutate, hook } = await censusHere();
  setFirestoreEnabled(false);
  await moveOut(partial => mutate({ ...partial, [night]: 'B2' } as DailyRecordPatch), 'discharge');
  setFirestoreEnabled(true);
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
  await replay();

  const remote = await server();
  expect(movedOut(remote, 'discharge')).toEqual([]);
  expect(remote.beds.R4).toMatchObject({ rut: '11111111-1' });
  expect(remote[night]).toBe('A1');
  const held = () =>
    hospitalDB.syncQueue.toArray().then(tasks =>
      tasks.map(task => ({
        status: task.status,
        night: (task.payload as DailyRecord)[night],
        discharges: movedOut(task.payload as DailyRecord, 'discharge'),
      }))
    );
  expect(await held()).toEqual([
    { status: 'CONFLICT', night: 'B2', discharges: ['PACIENTE SINTETICO A'] },
  ]);
  expect((await getSyncQueueTelemetry()).conflict).toBe(1);

  // «Reintentar» still meets the remote text without overwriting it.
  const [task] = await hospitalDB.syncQueue.toArray();
  expect(await retryQuarantinedSyncTask(task.id!)).toBe(true);
  await replay();
  expect((await server())[night]).toBe('A1');
  expect(movedOut(await server(), 'discharge')).toEqual([]);
  expect(await held()).toEqual([
    { status: 'CONFLICT', night: 'B2', discharges: ['PACIENTE SINTETICO A'] },
  ]);
  expect((await hospitalDB.dailyRecords.get(date))?.[night]).toBe('B2');
  hook.unmount();
}, 60_000);

/** An earlier movement of another patient, already on the day at 08:00. */
const earlierMovement = (kind: Movement) => (day: DailyRecord) => {
  const fields = {
    id: 'earlier',
    patientName: 'PACIENTE SINTETICO B',
    rut: '10000013-K',
    bedId: 'R5',
    time: '08:00',
  };
  if (kind === 'discharge') day.discharges = [DataFactory.createMockDischarge(fields)];
  else day.transfers = [DataFactory.createMockTransfer(fields)];
};
const earlierTime = async (kind: Movement) =>
  ((await server())[listOf(kind)] as { id: string; time: string }[]).find(
    item => item.id === 'earlier'
  )?.time;
/** Another computer corrects the earlier movement's time and writes the text first. */
const correctEarlierElsewhere = async (kind: Movement) => {
  const list = (await server())[listOf(kind)] as { id: string }[];
  await admin.doc(dayPath).update({
    [listOf(kind)]: list.map(item => (item.id === 'earlier' ? { ...item, time: '09:30' } : item)),
    [night]: 'A1',
    lastUpdated: Timestamp.now(),
  });
};

// Both computers changed the same earlier movement to different times: nothing of this write is
// published, and all of it waits for review with this computer's values (SAVE-02, SAVE-03).
it.each(['discharge', 'transfer'] as const)(
  'holds the whole write when both computers changed the same earlier «%s»',
  async kind => {
    const { mutate, hook } = await censusHere(earlierMovement(kind));
    const list = shown()!.record![listOf(kind)] as { id: string }[];
    setFirestoreEnabled(false);
    await mutate({
      [listOf(kind)]: list.map(item => ({ ...item, time: '10:15' })),
      [night]: 'B2',
    } as DailyRecordPatch);
    setFirestoreEnabled(true);
    await correctEarlierElsewhere(kind);
    await replay();

    expect(await earlierTime(kind)).toBe('09:30');
    expect((await server())[night]).toBe('A1');
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks.map(task => task.status)).toEqual(['CONFLICT']);
    const payload = tasks[0].payload as DailyRecord;
    expect(payload[night]).toBe('B2');
    expect((payload[listOf(kind)] as { time: string }[]).map(item => item.time)).toEqual(['10:15']);
    hook.unmount();
  },
  60_000
);

// The crib travels in its mother's bed, which is compared whole: another computer's edit of the
// newborn holds the whole write for review without clearing it (ID-01).
it('holds «Dar de alta» of mother and newborn when another computer changed the newborn', async () => {
  const { mutate, hook } = await censusHere(day => {
    day.beds.R4 = {
      ...day.beds.R4,
      hasCompanionCrib: true,
      clinicalCrib: DataFactory.createMockPatient('R4', {
        patientName: 'RN SINTETICO A',
        rut: '12345678-5',
        clinicalEpisodeId: 'episode-rn',
        admissionDate: date,
      }),
    };
  });
  setFirestoreEnabled(false);
  await moveOut(partial => mutate({ ...partial, [night]: 'B2' } as DailyRecordPatch), 'discharge');
  setFirestoreEnabled(true);
  await admin.doc(dayPath).update({
    'beds.R4.clinicalCrib.pathology': 'A6',
    [night]: 'A1',
    lastUpdated: Timestamp.now(),
  });
  await replay();

  const remote = await server();
  expect(remote.beds.R4).toMatchObject({ rut: '11111111-1' });
  expect(remote.beds.R4.clinicalCrib).toMatchObject({ rut: '12345678-5', pathology: 'A6' });
  expect(movedOut(remote, 'discharge')).toEqual([]);
  expect((await hospitalDB.syncQueue.toArray()).map(task => task.status)).toEqual(['CONFLICT']);
  hook.unmount();
}, 60_000);

// This computer removed the earlier movement from its list by absence while adding its own and a
// text changed elsewhere: the whole write, with the removal, waits for review.
it('holds the whole write when it removes an earlier movement by absence', async () => {
  const { mutate, hook } = await censusHere(earlierMovement('discharge'));
  setFirestoreEnabled(false);
  await moveOut(
    partial =>
      mutate({
        ...partial,
        discharges: (partial.discharges as { id: string }[]).filter(item => item.id !== 'earlier'),
        [night]: 'B2',
      } as DailyRecordPatch),
    'discharge'
  );
  setFirestoreEnabled(true);
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
  await replay();

  expect(await earlierTime('discharge')).toBe('08:00');
  expect(movedOut(await server(), 'discharge')).toEqual(['PACIENTE SINTETICO B']);
  expect((await server())[night]).toBe('A1');
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks.map(task => task.status)).toEqual(['CONFLICT']);
  const payload = tasks[0].payload as DailyRecord;
  expect(payload[night]).toBe('B2');
  expect(movedOut(payload, 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  hook.unmount();
}, 60_000);
