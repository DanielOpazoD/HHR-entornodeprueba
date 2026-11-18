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
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { buildClinicalCribPatch } from '@/hooks/controllers/clinicalCribController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { usePatientMovementCreationExecutor } from '@/hooks/usePatientMovementCreationExecutor';
import {
  buildAddDischargeInput,
  buildAddTransferInput,
  buildDischargeAddCommandPayload,
  buildTransferCommandPayload,
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/application/census/public';
import { createEmptyPatient } from '@/services/factories/patientFactory';
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
} from '@/services/storage/sessionScopedStorageService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';

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
vi.mock('@/firebaseConfig', () => ({
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
    let payload: { result?: { updatedRemotely?: boolean; reason?: string } } = {};
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
  expect(first?.updatedRemotely).toBe(false);
  expect(first?.reason).toBe('field_changed_elsewhere');
  const second = await edit(night, 'B3');
  expect((await server())[night]).toBe('A1');
  expect(second?.updatedRemotely).toBe(false);
  expect(second?.reason).toBe('field_changed_elsewhere');
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
  expect(day?.updatedRemotely).toBe(true);
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
    expect(again?.reason).toBe('field_changed_elsewhere');
    expect((await server())[night]).toBe('A1');
    // A field nobody else changed is saved at once.
    expect((await edit('handoffNovedadesDayShift', 'B6'))?.updatedRemotely).toBe(true);

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
// the clear to the server's day, so the bed is cleared while a diagnosis waits after the notice,
// and that diagnosis stays held for the patient it was written for (ID-01), never on the empty bed.
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
  expect(discharge?.updatedRemotely).toBe(true);
  expect((await server()).beds.R4).toMatchObject({ rut: '', pathology: '' });
  const held = (await hospitalDB.syncQueue.toArray()).filter(
    task => (task.payload as DailyRecord | undefined)?.beds?.R4?.pathology === 'B4'
  );
  expect(held.map(task => [task.status, (task.payload as DailyRecord).beds.R4.rut])).toEqual([
    ['CONFLICT', '11111111-1'],
  ]);
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
      ? resolveAddDischargeMovement(
          buildAddDischargeInput({
            record,
            bedId: 'R4',
            payload: buildDischargeAddCommandPayload({
              status: 'Vivo',
              dischargeType: 'Domicilio (Habitual)',
              time: '10:00',
              target: 'both',
            }),
            bedsCatalog: BEDS,
            createEmptyPatient,
          })
        )
      : resolveAddTransferMovement(
          buildAddTransferInput({
            record,
            bedId: 'R4',
            payload: buildTransferCommandPayload({
              method: 'Avión comercial',
              center: 'Hospital Salvador',
              centerOther: '',
              time: '10:00',
            }),
            bedsCatalog: BEDS,
            createEmptyPatient,
          })
        );
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
  return outcomes as { updatedRemotely?: boolean; reason?: string }[];
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

// W12-CW10. «Dar de alta» and «Traslado» are not a bed clear: the census's movement executor saves
// the movement list and the freed bed in one write that the day's queue task publishes. Folded
// into the day's task, that write replaced the bed and with it the diagnosis written here for the
// patient who leaves, which was then neither on the server nor in the queue (SAVE-03). It now stays
// held for that patient and episode (ID-01), as when a confirmed command empties the bed (W12-CW8),
// and the movement still reaches the server on its own.
it.each(['discharge', 'transfer'] as const)(
  '«%s» publishes the movement and keeps for its patient a diagnosis written here offline',
  async kind => {
    const { mutate, hook } = await censusHere();
    setFirestoreEnabled(false);
    await mutate({ 'beds.R4.pathology': 'B4' } as DailyRecordPatch);
    setFirestoreEnabled(true);

    const [saved] = await moveOut(mutate, kind);
    expect(saved?.reason).toBe('queue_route');
    await replay();

    const remote = await server();
    expect(remote.beds.R4).toMatchObject({ rut: '', pathology: '' });
    expect(movedOut(remote, kind)).toEqual(['PACIENTE SINTETICO A']);
    expect(await heldTasks()).toEqual([
      {
        status: 'CONFLICT',
        patient: ['11111111-1', 'episode-a'],
        pathology: 'B4',
        paths: ['beds.R4.pathology'],
      },
    ]);
    expect((await hospitalDB.syncQueue.toArray())[0].error).toMatch(/ya no tiene a PACIENTE/);
    hook.unmount();
  },
  60_000
);

// W12-CW10. The diagnosis waits after «El campo cambió en otro equipo»: another computer wrote one
// for this patient, and the screen keeps this person's. Moving the patient out keeps this person's
// diagnosis held for them (it used to be replaced by the empty bed and lost), and the movement does
// not clear the other computer's diagnosis unseen (SAVE-02, as with no diagnosis waiting here): it
// waits for review, and the sync status counts it.
it.each(['discharge', 'transfer'] as const)(
  '«%s» of a patient whose diagnosis waits after the notice keeps that diagnosis for them',
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
    expect(tasks.filter(task => task.pathology === 'B4')).toEqual([
      {
        status: 'CONFLICT',
        patient: ['11111111-1', 'episode-a'],
        pathology: 'B4',
        paths: ['beds.R4.pathology'],
      },
    ]);
    // The movement itself, on its empty bed, waits for review.
    expect(
      tasks.filter(task => task.paths?.includes(listOf(kind))).map(task => task.status)
    ).toEqual(['CONFLICT']);
    expect((await getSyncQueueTelemetry()).conflict).toBe(2);
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
      expect((await edit(night, 'B2'))?.reason).toBe('field_changed_elsewhere');
      expect((await edit(night, 'B3'))?.reason).toBe('field_changed_elsewhere');
      // A field nobody else changed is still saved at once (#1603).
      expect((await edit('handoffNovedadesDayShift', 'B4'))?.updatedRemotely).toBe(true);
      expect((await edit(night, 'B5'))?.reason).toBe('field_changed_elsewhere');
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

// W12-CW12. With a text of the day held after the notice, a later «Dar de alta» folds into that
// held write. Its replay refused the whole write because the text changed elsewhere, and the
// patient stayed in the bed on the server until someone reviewed the text. The replay now
// publishes the movement with its freed bed, and only the text stays held, in the same task, so
// the next edit of it meets the other computer's text again (rule of 15-11: different fields keep
// both, the same field warns the second).
it('«Dar de alta» reaches the server while a text of the day waits after the notice', async () => {
  const { mutate, edit, hook } = await conflictOnNight();
  await recover(hook, 'refetch');
  await moveOut(mutate, 'discharge');
  await replay();

  const remote = await server();
  expect(movedOut(remote, 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  expect(remote.beds.R4).toMatchObject({ rut: '', patientName: '' });
  expect(remote[night]).toBe('A1');
  expect(
    (await hospitalDB.syncQueue.toArray()).map(task => [
      task.key,
      task.status,
      task.syncContract?.changedPaths,
      (task.payload as DailyRecord)[night],
      task.lastErrorCode,
    ])
  ).toEqual([[`daily:${date}`, 'CONFLICT', [night], 'B3', 'daily_record_field_changed_elsewhere']]);
  // This computer shows the discharge with the text it keeps.
  const local = await hospitalDB.dailyRecords.get(date);
  expect(local?.[night]).toBe('B3');
  expect(movedOut(local, 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  expect((await getSyncQueueTelemetry()).conflict).toBe(1);

  // Still a field the other computer changed: met again, not replaced.
  expect((await edit(night, 'B5'))?.reason).toBe('field_changed_elsewhere');
  await replay();
  expect((await server())[night]).toBe('A1');
  await expectUnsentNightKept('B5');
  expect(movedOut(await server(), 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  hook.unmount();
}, 60_000);

// W12-CW12. Offline, one save holds a text of the day and the movement, and another computer
// changes that text. The replay publishes the movement under a mutation id of its own: «Reintentar»
// on the held text later meets the other computer's text again, never taken as already sent.
it('publishes «Dar de alta» saved offline with a text changed elsewhere, and keeps the text', async () => {
  const { mutate, hook } = await censusHere();
  setFirestoreEnabled(false);
  await moveOut(partial => mutate({ ...partial, [night]: 'B2' } as DailyRecordPatch), 'discharge');
  setFirestoreEnabled(true);
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
  await replay();

  expect(movedOut(await server(), 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  const held = () =>
    hospitalDB.syncQueue
      .toArray()
      .then(tasks =>
        tasks.map(task => [
          task.status,
          task.syncContract?.changedPaths,
          (task.payload as DailyRecord)[night],
        ])
      );
  expect(await held()).toEqual([['CONFLICT', [night], 'B2']]);

  // «Reintentar» on the held text, in the review of pending changes.
  const [task] = await hospitalDB.syncQueue.toArray();
  expect(await retryQuarantinedSyncTask(task.id!)).toBe(true);
  await replay();
  expect((await server())[night]).toBe('A1');
  expect(await held()).toEqual([['CONFLICT', [night], 'B2']]);
  expect((await hospitalDB.dailyRecords.get(date))?.[night]).toBe('B2');
  hook.unmount();
}, 60_000);

// W12-CW12. The browser closed after the server confirmed the movement and before the queue
// recorded it: the next replay finds the movement already there and the text still held.
it('keeps the text held when the confirmation of the published movement was lost', async () => {
  const { mutate, hook } = await censusHere();
  setFirestoreEnabled(false);
  await moveOut(partial => mutate({ ...partial, [night]: 'B2' } as DailyRecordPatch), 'discharge');
  setFirestoreEnabled(true);
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
  const [queued] = await hospitalDB.syncQueue.toArray();
  const shownBefore = await hospitalDB.dailyRecords.get(date);
  await replay();
  expect(movedOut(await server(), 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.syncQueue.put(queued);
  await hospitalDB.dailyRecords.put(shownBefore!);

  await replay();
  expect(movedOut(await server(), 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  expect((await server())[night]).toBe('A1');
  expect(
    (await hospitalDB.syncQueue.toArray()).map(task => [
      task.status,
      task.syncContract?.changedPaths,
      (task.payload as DailyRecord)[night],
    ])
  ).toEqual([['CONFLICT', [night], 'B2']]);
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

// W12-CW12, from the independent review. The movement list is rebased item by item: the earlier
// movement this computer did not touch keeps the other computer's correction (SAVE-02), and this
// computer's new movement is still published, with only the text held.
it.each(['discharge', 'transfer'] as const)(
  '«%s» saved offline keeps another computer’s correction of an earlier one, and the text held',
  async kind => {
    const { mutate, hook } = await censusHere(earlierMovement(kind));
    setFirestoreEnabled(false);
    await moveOut(partial => mutate({ ...partial, [night]: 'B2' } as DailyRecordPatch), kind);
    setFirestoreEnabled(true);
    await correctEarlierElsewhere(kind);
    await replay();

    expect(await earlierTime(kind)).toBe('09:30');
    expect(movedOut(await server(), kind)).toEqual([
      'PACIENTE SINTETICO B',
      'PACIENTE SINTETICO A',
    ]);
    expect((await server()).beds.R4).toMatchObject({ rut: '', patientName: '' });
    expect((await server())[night]).toBe('A1');
    expect(
      (await hospitalDB.syncQueue.toArray()).map(task => [
        task.status,
        task.syncContract?.changedPaths,
        (task.payload as DailyRecord)[night],
      ])
    ).toEqual([['CONFLICT', [night], 'B2']]);
    hook.unmount();
  },
  60_000
);

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
// newborn stops the split, and «Dar de alta» of both waits for review without clearing it (ID-01).
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

// From the re-review. This computer removed the earlier movement from its list by absence (no
// `deletedAt`) while adding its own and a text. The merge by id would bring that movement back, so
// nothing is split off: the whole write, with the removal, waits for review as before.
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

// Another computer removed the earlier movement by absence: the item this computer did not touch
// keeps the stored absence, and this computer's movement is published with only the text held.
it('keeps another computer’s removal of an earlier movement and publishes this one', async () => {
  const { mutate, hook } = await censusHere(earlierMovement('discharge'));
  setFirestoreEnabled(false);
  await moveOut(partial => mutate({ ...partial, [night]: 'B2' } as DailyRecordPatch), 'discharge');
  setFirestoreEnabled(true);
  await admin.doc(dayPath).update({ discharges: [], [night]: 'A1', lastUpdated: Timestamp.now() });
  await replay();

  expect(await earlierTime('discharge')).toBeUndefined();
  expect(movedOut(await server(), 'discharge')).toEqual(['PACIENTE SINTETICO A']);
  expect(
    (await hospitalDB.syncQueue.toArray()).map(task => [
      task.status,
      task.syncContract?.changedPaths,
    ])
  ).toEqual([['CONFLICT', [night]]]);
  hook.unmount();
}, 60_000);
