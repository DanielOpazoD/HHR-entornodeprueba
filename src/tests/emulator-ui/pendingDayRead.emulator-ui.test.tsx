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
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { BEDS } from '@/constants/beds';
import { processSyncQueue } from '@/services/storage/sync';
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

/**
 * SAVE-01, the read of a day that pending writes hold: the server's day with each pending path on
 * top exactly as the write holds it (lists included: a device chosen offline stays on screen, in the
 * copy and in the next edit), never confirmed when a path cannot be put on top with certainty (a
 * list merged by id that the server also changed), and with no shortcut over real data (the extra
 * beds' visibility). Real rules, the shipped authority handler, the Firestore emulator, the census
 * hook (evidence/W14/H1B/recheck3).
 */
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { syncRecordsRange } from '@/services/records/recordQueryService';
import { buildVisibleBeds } from '@/features/census/controllers/censusTableViewController';
import { useDevicesCellController } from '@/features/census/components/patient-row/useDevicesCellController';
import { buildToggleExtraBedPatches } from '@/hooks/controllers/bedManagementPatchController';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { captureAuthoringSession } from '@/services/session/authoringSession';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';

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
const projectId = 'demo-hhr-pending-day-read';
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
  app = initializeApp({ projectId }, 'pending-day-read');
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
const replay = async () => {
  const now = Date.now.bind(Date);
  for (let round = 1; round <= 3; round++) {
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + round * 10 * 60_000);
    try {
      await processSyncQueue();
    } finally {
      clock.mockRestore();
    }
  }
};
const visibleE1 = (record: DailyRecord) =>
  buildVisibleBeds({ allBeds: BEDS, activeExtraBeds: record.activeExtraBeds }).some(
    bed => bed.id === 'E1'
  );

// Recheck 3, finding 2: the extra beds' visibility is data, not something derived here.
it.each([
  [false, 'sdk'],
  [true, 'sdk'],
  [false, 'raw'],
  [true, 'raw'],
] as const)(
  'shows, confirmed, another computer turning extra bed E1 %s → toggled (writer %s), with the pending note',
  async (enabled, writer) => {
    const c = await censusHere(day => {
      day.activeExtraBeds = enabled ? ['E1'] : [];
    });
    setFirestoreEnabled(false);
    await c.edit(night, 'pendiente');
    setFirestoreEnabled(true);
    const events: DailyRecordReadResult[] = [];
    const stop = subscribeDetailed(date, result => {
      if (result.serverConfirmed) events.push(result);
    });
    try {
      await waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 10_000 });
      const seen = events.length;
      const patch = buildToggleExtraBedPatches(await server(), 'E1');
      if (writer === 'raw')
        await admin.doc(dayPath).update({ ...patch, lastUpdated: Timestamp.now() });
      else {
        const own = h.db;
        h.db = env
          .authenticatedContext('synthetic-A', {
            role: 'nurse_hospital',
            email: 'synthetic-A@example.invalid',
          })
          .firestore();
        try {
          const current = await server();
          await updateRecordPartial(date, patch, current.lastUpdated, {
            baseRecord: current,
            historyPolicy: 'skip',
            syncContract: { changedPaths: Object.keys(patch), mutationId: 'synthetic-toggle' },
          });
        } finally {
          h.db = own;
        }
      }
      await waitFor(() => expect(events.length).toBeGreaterThan(seen), { timeout: 10_000 });
      const live = events.at(-1)!;
      const point = await getForDateWithMeta(date);
      const local = await hospitalDB.dailyRecords.get(date);
      expect({
        server: visibleE1(await server()),
        live: visibleE1(live.record!),
        point: visibleE1(point.record!),
        local: visibleE1(local!),
        confirmed: [live.serverConfirmed, point.serverConfirmed],
        pending: live.record?.[night],
      }).toEqual({
        server: !enabled,
        live: !enabled,
        point: !enabled,
        local: !enabled,
        confirmed: [true, true],
        pending: 'pendiente',
      });
    } finally {
      stop();
      c.hook.unmount();
    }
  },
  30_000
);

// Recheck 3, finding 1: a device chosen offline is a pending list; a read never drops it.
it.each([false, true])(
  'keeps a device chosen offline on screen, in the copy and in the next edit (next edit: %s)',
  async followup => {
    const c = await censusHere(day => {
      day.beds.R4.devices = [];
    });
    try {
      setFirestoreEnabled(false);
      const calls: Promise<unknown>[] = [];
      const devices = renderHook(() =>
        useDevicesCellController({
          data: shown()!.record!.beds.R4,
          onDevicesChange: vi.fn(),
          onDeviceDetailsChange: vi.fn(),
          onDeviceHistoryChange: vi.fn(),
          onDeviceBundleChange: fields =>
            calls.push(
              c.mutate(
                bedManagementReducer(shown()!.record!, {
                  type: 'UPDATE_PATIENT_MULTIPLE',
                  bedId: 'R4',
                  fields,
                }) as DailyRecordPatch
              )
            ),
        })
      );
      devices.result.current.handleDevicesChange(['CVC']);
      await Promise.all(calls);
      devices.unmount();
      expect(
        ((await hospitalDB.syncQueue.toArray())[0].payload as DailyRecord).beds.R4.devices
      ).toEqual(['CVC']);
      setFirestoreEnabled(true);
      // Another computer changes an independent field of the same patient.
      await admin.doc(dayPath).update({ 'beds.R4.age': '52', lastUpdated: Timestamp.now() });

      const point = await getForDateWithMeta(date);
      const [range] = await syncRecordsRange(date, date);
      c.hook.rerender({ live: true });
      await waitFor(() => expect(shown()?.record?.beds.R4.age).toBe('52'));
      expect(point.record?.beds.R4.devices).toEqual(['CVC']);
      expect(point.serverConfirmed).toBe(true);
      expect(range.beds.R4.devices).toEqual(['CVC']);
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R4.devices).toEqual(['CVC']);
      expect(shown()?.record?.beds.R4.devices).toEqual(['CVC']);
      if (followup) {
        setFirestoreEnabled(false);
        await c.edit(night, 'segunda edición');
        setFirestoreEnabled(true);
      }
      expect(
        (await hospitalDB.syncQueue.toArray()).map(
          task => (task.payload as DailyRecord).beds.R4.devices
        )
      ).toEqual([['CVC']]);
      // The resend meets the patient another computer changed and is held as a conflict, as it is
      // without any read in between (evidence/W14/H1B/recheck3): out of this unit. What this unit
      // owns is that neither edit is lost from the send.
      if (followup) {
        await replay();
        const [held] = await hospitalDB.syncQueue.toArray();
        expect((held.payload as DailyRecord).beds.R4.devices).toEqual(['CVC']);
        expect((held.payload as DailyRecord)[night]).toBe('segunda edición');
      }
    } finally {
      c.hook.unmount();
    }
  },
  60_000
);

it('returns the stored copy, confirmed and not rewritten, when only its FHIR resource differs', async () => {
  const c = await censusHere();
  try {
    setFirestoreEnabled(false);
    await c.edit(night, 'pendiente');
    setFirestoreEnabled(true);
    await getForDateWithMeta(date);
    const row = (await hospitalDB.dailyRecords.get(date))!;
    await hospitalDB.dailyRecords.put({
      ...row,
      beds: {
        ...row.beds,
        R4: { ...row.beds.R4, fhir_resource: { resourceType: 'Patient', id: 'local-derived' } },
      },
    } as DailyRecord);
    const bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    try {
      const point = await getForDateWithMeta(date);
      expect(point.serverConfirmed).toBe(true);
      expect(point.record?.beds.R4.fhir_resource?.id).toBe('local-derived');
      expect(bulk).not.toHaveBeenCalled();
    } finally {
      bulk.mockRestore();
    }
  } finally {
    c.hook.unmount();
  }
}, 30_000);

/** Each kind of list merged by id: an item written offline, and an item another computer adds. */
const lists = {
  clinicalEvents: {
    path: 'beds.R4.clinicalEvents',
    item: (id: string) => ({ id, name: `EVENTO ${id}`, date, createdAt: `${date}T10:00:00.000Z` }),
  },
  medicalHandoffEntries: {
    path: 'beds.R4.medicalHandoffEntries',
    item: (id: string) => ({ id, specialty: 'MEDICINA', note: `ENTREGA ${id}` }),
  },
  discharges: {
    path: 'discharges',
    item: (id: string) => ({ id, bedId: 'R2', patientName: `ALTA ${id}`, status: 'Vivo' }),
  },
  cma: {
    path: 'cma',
    item: (id: string) => ({ id, bedName: 'CMA', patientName: `CMA ${id}` }),
  },
  cribClinicalEvents: {
    path: 'beds.R4.clinicalCrib.clinicalEvents',
    item: (id: string) => ({
      id,
      name: `EVENTO RN ${id}`,
      date,
      createdAt: `${date}T10:00:00.000Z`,
    }),
  },
  tensDayShift: {
    path: 'tensDayShift',
    item: (id: string) => `TENS ${id}`,
  },
} as const;
/** An element of a list as stored: an object may gain normalized fields, a text stays as is. */
const matching = (value: unknown) =>
  typeof value === 'object' && value !== null ? expect.objectContaining(value) : value;
/** The newborn in R4's crib, for the lists that live on it. */
const withNewborn = (day: DailyRecord) => {
  day.beds.R4.clinicalCrib = DataFactory.createMockPatient('R4', {
    patientName: 'RN SINTETICO',
    rut: '',
    clinicalEpisodeId: 'episode-newborn',
    bedMode: 'Cuna',
    admissionDate: date,
  });
};

it.each(Object.keys(lists) as (keyof typeof lists)[])(
  'shows a pending %s item with the server’s day, and never confirms it when the server changed that list too',
  async kind => {
    const { path, item } = lists[kind];
    const c = await censusHere(kind === 'cribClinicalEvents' ? withNewborn : undefined);
    c.hook.unmount();
    // The base is the day as the app read it (normalized), as a census edit's base is.
    const day = (await getForDateWithMeta(date)).record!;
    const patch = { [path]: [item('local')] } as DailyRecordPatch;
    expect(
      await queueDailyRecordSyncTaskWithLocalRecord(
        applyPatches(day, patch),
        { syncContract: { changedPaths: [path], expectedVersion: day.lastUpdated } },
        {
          deferProcessing: true,
          authoringSession: captureAuthoringSession(),
          patchWrite: { patch, baseRecord: day, prepare: applyPatches },
        }
      )
    ).toMatchObject({ accepted: true });

    // Another computer changes an independent field: the pending item and that change, confirmed.
    await admin
      .doc(dayPath)
      .update({ handoffNovedadesDayShift: 'OTRO EQUIPO', lastUpdated: Timestamp.now() });
    const composed = await getForDateWithMeta(date);
    expect(composed.serverConfirmed).toBe(true);
    expect(composed.record?.handoffNovedadesDayShift).toBe('OTRO EQUIPO');
    expect(getValueAtPath(composed.record, path)).toEqual([matching(item('local'))]);

    // Another computer adds to the same list: it cannot be shown with certainty, so not confirmed.
    const stored = await hospitalDB.dailyRecords.get(date);
    await admin.doc(dayPath).update({ [path]: [item('remote')], lastUpdated: Timestamp.now() });
    const kept = await getForDateWithMeta(date);
    expect(kept.serverConfirmed).toBe(false);
    expect(kept.record).toEqual(stored);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(stored);
    expect(getValueAtPath((await hospitalDB.syncQueue.toArray())[0].payload, path)).toEqual([
      matching(item('local')),
    ]);
  },
  30_000
);

import { createRequire } from 'node:module';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
const { createRayenClinicalEnrichmentFunctions } = createRequire(import.meta.url)(
  '../../../functions/lib/rayenClinicalEnrichmentFunctions.js'
);
const readLive = async () => {
  const delivered: DailyRecordReadResult[] = [];
  const stop = subscribeDetailed(date, result => {
    if (result.record && result.publication !== 'superseded') delivered.push(result);
  });
  try {
    // The listener answers from the SDK cache first and then from the server, through the same
    // admission as a point read; once the answers settle, the last one is the server's.
    await waitFor(() => expect(delivered.length).toBeGreaterThan(0), { timeout: 10000 });
    for (let seen = 0; seen !== delivered.length; ) {
      seen = delivered.length;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return delivered.at(-1)!;
  } finally {
    stop();
  }
};
type Where = 'bed' | 'crib';
const here = (record: DailyRecord, where: Where) =>
  where === 'bed' ? record.beds.R1 : record.beds.R1.clinicalCrib!;
const prefix = (where: Where) => (where === 'bed' ? 'beds.R1' : 'beds.R1.clinicalCrib');
const deviceEntry = (id: string, type: string, episode: string) => ({
  id,
  type,
  installationDate: date,
  source: 'eloisa' as const,
  status: 'Active' as const,
  createdAt: 1,
  updatedAt: 2,
  clinicalEpisodeId: episode,
});
const cases = [
  ['bed', 'devices'],
  ['crib', 'devices'],
  ['bed', 'history'],
  ['crib', 'history'],
  ['bed', 'unowned-history'],
  ['crib', 'unowned-history'],
  ['bed', 'replace'],
  ['crib', 'replace'],
  ['crib', 'replace-parent'],
  ['bed', 'missing-base'],
  ['crib', 'missing-base'],
] as const;
// Recheck 4, finding 1: the newborn's lists are lists too, wherever they live.
it.each(cases)(
  'device review %s %s',
  async (where, mode) => {
    const episode = where === 'bed' ? 'episode-synthetic-parent' : 'episode-synthetic-crib';
    const remoteEntry = deviceEntry('from-eloisa', 'SNG', episode);
    const c = await censusHere(day => {
      Object.assign(day, { meta: { revision: 2 } });
      day.rayenSyncHistory = [
        {
          id: 'synthetic-run',
          sourceDate: date,
          status: 'applied',
          startedAt: new Date().toISOString(),
          by: 'synthetic-rayen',
          policy: { schemaVersion: 2, mode: 'preview', revision: 7, clinicalBatchMode: 'enforced' },
        },
      ] as never;
      day.beds.R1 = DataFactory.createMockPatient('R1', {
        patientName: 'MADRE SINTETICA',
        rut: '22222222-2',
        clinicalEpisodeId: 'episode-synthetic-parent',
        admissionDate: date,
        devices: [],
        deviceInstanceHistory: [],
        clinicalCrib: DataFactory.createMockPatient('R1', {
          patientName: 'RN SINTETICO',
          rut: '',
          clinicalEpisodeId: 'episode-synthetic-crib',
          bedMode: 'Cuna',
          admissionDate: date,
          devices: [],
          deviceInstanceHistory: [],
        }),
      });
    });
    try {
      setFirestoreEnabled(false);
      if (mode === 'unowned-history') await c.edit(night, 'nota local');
      else {
        const calls: Promise<unknown>[] = [];
        const device = renderHook(() =>
          useDevicesCellController({
            data: here(shown()!.record!, where),
            onDevicesChange: vi.fn(),
            onDeviceDetailsChange: vi.fn(),
            onDeviceHistoryChange: vi.fn(),
            onDeviceBundleChange: fields =>
              calls.push(
                c.mutate(
                  bedManagementReducer(shown()!.record!, {
                    type:
                      where === 'bed' ? 'UPDATE_PATIENT_MULTIPLE' : 'UPDATE_CLINICAL_CRIB_MULTIPLE',
                    bedId: 'R1',
                    fields,
                  }) as DailyRecordPatch
                )
              ),
          })
        );
        device.result.current.handleDevicesChange(['CVC']);
        await Promise.all(calls);
        device.unmount();
      }
      c.hook.unmount();
      setFirestoreEnabled(true);
      const root = prefix(where);
      const [task] = await hospitalDB.syncQueue.toArray();
      if (mode !== 'unowned-history') {
        expect(task.syncContract?.changedPaths).toContain(root + '.devices');
        expect(here(task.payload as DailyRecord, where).devices).toEqual(['CVC']);
      }
      if (mode === 'missing-base')
        await hospitalDB.syncQueue.update(task.id!, { patchBaseValues: {} });
      const other =
        mode === 'devices'
          ? { [root + '.devices']: ['SNG'], [root + '.deviceInstanceHistory']: [remoteEntry] }
          : mode.includes('history')
            ? { [root + '.deviceInstanceHistory']: [remoteEntry] }
            : mode === 'replace' || mode === 'replace-parent'
              ? {
                  [(mode === 'replace-parent' ? 'beds.R1' : root) + '.clinicalEpisodeId']:
                    'episode-replacement',
                  [(mode === 'replace-parent' ? 'beds.R1' : root) + '.patientName']:
                    'REEMPLAZO SINTETICO',
                }
              : {};
      if (mode.includes('history')) {
        const api = createRayenClinicalEnrichmentFunctions({
          firestore: admin,
          Timestamp,
          resolveRoleForEmail: async () => 'admin',
        });
        const prior = await server();
        const response = await api.applyRayenClinicalEnrichmentBatch.run(
          {
            date,
            authorityDate: date,
            runId: 'synthetic-run',
            mutationId: 'synthetic-rayen-device',
            expectedLastUpdated: prior.lastUpdated,
            baseRevision: 2,
            mode: 'enforced',
            fieldContractVersion: 2,
            patches: [
              {
                bedId: 'R1',
                clinicalCrib: where === 'crib',
                clinicalEpisodeId: episode,
                fields: {
                  deviceInstanceHistory: [{ ...remoteEntry, status: 'Removed', removalDate: date }],
                },
              },
            ],
          },
          { auth: { uid: 'synthetic-rayen', token: { email: 'rayen@example.invalid' } } }
        );
        expect(response.authorityStatus).toBe('ok');
        expect(response.patientWrites).toBe(1);
      } else
        await admin.doc(dayPath).update({
          ...other,
          handoffNovedadesDayShift: 'otro equipo',
          lastUpdated: Timestamp.now(),
        });
      const point = await getForDateWithMeta(date);
      const live = await readLive();
      const stored = (await hospitalDB.dailyRecords.get(date))!;
      const remote = await server();
      const [after] = await hospitalDB.syncQueue.toArray();
      const view = (r: DailyRecord) => {
        const p = here(r, where);
        return {
          devices: p.devices,
          history: p.deviceInstanceHistory?.map(row => row.type),
          id: p.clinicalEpisodeId,
        };
      };
      expect(view(remote).devices).toBeDefined();
      expect(live.serverConfirmed).toBe(point.serverConfirmed);
      expect(view(live.record!)).toEqual(view(point.record!));
      expect(after.payload).toEqual(task.payload);
      expect(point.record).toEqual(stored);
      if (mode === 'unowned-history') {
        expect(point.serverConfirmed).toBe(true);
        expect(view(point.record!).history).toEqual(['SNG']);
        expect(point.record?.[night]).toBe('nota local');
      } else {
        expect(point.serverConfirmed).toBe(false);
        expect(view(stored).devices).toEqual(['CVC']);
        expect(view(stored).id).toBe(episode);
      }
    } finally {
      c.hook.unmount();
    }
  },
  30000
);

it('preserves another bed activated while a different extra bed activation is pending', async () => {
  const c = await censusHere(day => {
    day.activeExtraBeds = [];
  });
  try {
    setFirestoreEnabled(false);
    await c.mutate(buildToggleExtraBedPatches(shown()!.record!, 'E1'));
    c.hook.unmount();
    setFirestoreEnabled(true);
    const current = await server();
    const patch = buildToggleExtraBedPatches(current, 'E2');
    const previous = h.db;
    h.db = env
      .authenticatedContext('synthetic-A', {
        role: 'nurse_hospital',
        email: 'synthetic-A@example.invalid',
      })
      .firestore();
    try {
      await updateRecordPartial(date, patch, current.lastUpdated, {
        baseRecord: current,
        historyPolicy: 'skip',
        syncContract: { changedPaths: Object.keys(patch), mutationId: 'synthetic-extra-e2' },
      });
    } finally {
      h.db = previous;
    }
    const result = await getForDateWithMeta(date);
    const live = await readLive();
    const [task] = await hospitalDB.syncQueue.toArray();
    const stored = await hospitalDB.dailyRecords.get(date);
    const actual = (await server()).activeExtraBeds;
    const visible = buildVisibleBeds({
      allBeds: BEDS,
      activeExtraBeds: live.record!.activeExtraBeds,
    })
      .filter(b => b.isExtra)
      .map(b => b.id);
    // Recheck 4, finding 2: never only E1 as confirmed while the server has E2.
    if (!result.serverConfirmed) expect(stored?.activeExtraBeds).toEqual(['E1']);
    if (live.serverConfirmed) expect(visible).toEqual(expect.arrayContaining(['E1', 'E2']));
    expect(actual).toContain('E2');
    expect((task.payload as DailyRecord).activeExtraBeds).toEqual(['E1']);
    if (result.serverConfirmed)
      expect(result.record?.activeExtraBeds).toEqual(expect.arrayContaining(['E1', 'E2']));
  } finally {
    c.hook.unmount();
  }
}, 30000);
