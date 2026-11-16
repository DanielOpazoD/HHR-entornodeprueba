/* @flake-safe: Synthetic census on the current clinical day, which the real rules let nurses and specialists write. */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
import { buildSpecialistHandoffTargets } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
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
 * record on screen, against the real rules, the shipped authority and specialist handlers and the
 * Firestore emulator.
 */
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  specialist: false,
  server: undefined as undefined | ((name: string, data: unknown) => Promise<unknown>),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    if (!h.server) throw new Error('no server');
    return { data: await h.server(name, data) };
  },
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<object>()),
  shouldRouteSpecialistPatchViaCallable: async () => h.specialist,
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
        claims: { role: h.specialist ? 'doctor_specialist' : 'nurse_hospital' },
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

// The server lets a specialist write only the current clinical day (yesterday before rollover).
const date = resolveCurrentClinicalDay();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-field-changed-elsewhere';
const night = 'handoffNovedadesNightShift';
const base = (): DailyRecord =>
  JSON.parse(
    JSON.stringify(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: new Date(Date.now() - 60_000).toISOString(),
        handoffNovedadesDayShift: 'DIA BASE',
        handoffNovedadesNightShift: 'NOCHE BASE',
        activeExtraBeds: [],
        beds: {
          R4: DataFactory.createMockPatient('R4', {
            patientName: 'PACIENTE SINTETICO A',
            rut: '11111111-1',
            clinicalEpisodeId: 'episode-a',
            admissionDate: date,
            medicalHandoffNote: '',
            medicalHandoffEntries: [{ id: 'entry-x', specialty: 'Medicina Interna', note: '' }],
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
  const { createSpecialistMedicalHandoffFunctions } = createRequire(import.meta.url)(
    '../../../functions/lib/specialistMedicalHandoffFunctions.js'
  );
  const specialistApi = createSpecialistMedicalHandoffFunctions({
    firestore: admin,
    Timestamp,
    resolveRoleForEmail: async () => 'doctor_specialist',
  });
  h.server = async (name, data) => {
    if (name !== 'updateSpecialistMedicalHandoff') throw new Error(`unexpected callable ${name}`);
    try {
      return await specialistApi.updateSpecialistMedicalHandoff.run(data, context());
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw Object.assign(new Error((error as Error).message), {
        code: code ? `functions/${code}` : 'functions/internal',
      });
    }
  };
});
afterEach(async () => {
  client?.clear();
  client?.unmount();
  h.specialist = false;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await deleteApp(app);
});

/** The census on this computer, its hook, and the other computer's text already on the server. */
const conflictOnNight = async () => {
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
  await admin.doc(dayPath).set(base());
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
  await hospitalDB.dailyRecords.put(base());
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  client.mount();
  setDailyRecordQueryData(client, date, base());
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
    let payload: { result?: { updatedRemotely?: boolean; observabilityTags?: string[] } } = {};
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

  // The other computer writes first; this screen has not received it yet.
  await admin.doc(dayPath).update({ [night]: 'A1', lastUpdated: Timestamp.now() });
  const first = await edit(night, 'B2');
  expect(first?.updatedRemotely).toBe(false);
  expect(first?.observabilityTags).toContain('field_changed_elsewhere');
  const second = await edit(night, 'B3');
  expect((await server())[night]).toBe('A1');
  expect(second?.updatedRemotely).toBe(false);
  expect(second?.observabilityTags).toContain('field_changed_elsewhere');
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
    expect(again?.observabilityTags).toContain('field_changed_elsewhere');
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

// Measured on main too, with a single conflict (W12-CW5 report): while a write in conflict holds
// the day, a confirmed read keeps this computer's copy as it was (dailyRecordRemoteReadController,
// retained_pending) and the outbox does not adopt a server day over a quarantined write
// (adoptAuthoritativeDailyRecordInOutbox). The copy's version stays behind the server's, so a
// specialist's note, checked against it, is refused until the conflict is reviewed. Its own unit.
it.fails(
  'lets a specialist note through after a confirmed read while a conflict holds the day',
  async () => {
    const { mutate, hook } = await conflictOnNight();
    await recover(hook, 'live');
    // Another computer's later write that this copy cannot take while the conflict holds it.
    await admin
      .doc(dayPath)
      .update({ handoffNovedadesDayShift: 'A7', lastUpdated: Timestamp.now() });
    await recover(hook, 'refetch');
    h.specialist = true;
    const visible = shown()!.record!;
    const { fields } = buildMedicalEntryNoteFields(
      visible.beds.R4,
      'entry-x',
      'NOTA SINTETICA',
      null,
      date,
      new Date().toISOString()
    );
    const note = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [`beds.R4.${key}`, value])
    ) as DailyRecordPatch;
    try {
      const noted = await mutate(note, {
        specialistHandoffTargets: buildSpecialistHandoffTargets(visible, note),
      });
      expect(noted?.updatedRemotely).toBe(true);
      expect(
        (await server()).beds.R4.medicalHandoffEntries?.find(entry => entry.id === 'entry-x')?.note
      ).toBe('NOTA SINTETICA');
    } finally {
      hook.unmount();
    }
  },
  60_000
);
