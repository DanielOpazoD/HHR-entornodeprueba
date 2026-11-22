/* @flake-safe: Synthetic census on the current clinical day, which the real rules let nurses write. */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ApplyDailyRecordPatchOptions } from '@/application/shared/dailyRecordCoreContracts';
import { useCallback, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { DefaultRepositoryProvider } from '@/context/RepositoryContext';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { useBedManagement } from '@/hooks/useBedManagement';
import { assertDailyRecordWriteAccepted } from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { useDevicesCellController } from '@/features/census/components/patient-row/useDevicesCellController';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { processSyncQueue } from '@/services/storage/sync';
import { captureAuthoringSession } from '@/services/session/authoringSession';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayAdmissionUtils';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/session/sessionScopedStorageService';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { PatientData } from '@/types/domain/patient';

/**
 * A device a nurse adds without network reaches the server when the network returns (SAVE-01).
 * The gesture runs the census path: the devices cell, the bed manager, the census patch, the
 * outbox and the queue, against the real rules, the shipped authority handlers, the Rayen fence of
 * production (policy schema 2) and the Firestore emulator. Online, the same gesture travels as a
 * patch; offline, the queue publishes it as a whole-day save, which used to put the stored devices
 * back and end the task as saved.
 */
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

// The bed manager's audit trail is out of scope; it never decides what is saved.
vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logDebouncedEvent: vi.fn(),
    logEvent: vi.fn(),
    logPatientAdmission: vi.fn(),
    userId: 'synthetic-B',
  }),
}));

const h = vi.hoisted(() => ({ db: undefined as unknown }));
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
      getIdTokenResult: async () => ({ claims: { role: 'nurse_hospital' } }),
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

const date = resolveCurrentClinicalDay();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-offline-device-replay';
const night = 'handoffNovedadesNightShift';
const base = (): DailyRecord =>
  JSON.parse(
    JSON.stringify(
      DataFactory.createMockDailyRecord(date, {
        lastUpdated: new Date(Date.now() - 60_000).toISOString(),
        dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
        handoffNovedadesNightShift: 'NOCHE BASE',
        activeExtraBeds: [],
        beds: {
          R4: DataFactory.createMockPatient('R4', {
            patientName: 'PACIENTE SINTETICO A',
            rut: '11111111-1',
            clinicalEpisodeId: 'episode-a',
            admissionDate: date,
            devices: [],
            clinicalCrib: DataFactory.createMockPatient('R4', {
              patientName: 'RN SINTETICO A',
              rut: '22222222-2',
              clinicalEpisodeId: 'episode-rn',
              admissionDate: date,
              devices: [],
            }),
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
  client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record ?? null;

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'offline-device-replay');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  h.db = env
    .authenticatedContext('synthetic-B', {
      role: 'nurse_hospital',
      email: 'synthetic-B@example.invalid',
    })
    .firestore();
  // The queue runs only when a test says so, so each step meets the queue as the last left it.
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
afterEach(() => {
  setFirestoreEnabled(true);
  client?.clear();
  client?.unmount();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await deleteApp(app);
});

type Holder = 'bed' | 'crib';

/**
 * This computer's census on the server's day, with the devices cell of R4 (bed or crib).
 * `localWithoutSng`: R4 has CVC and SNG with confirmed notes, and this computer's copy of the same
 * version never got the SNG detail.
 */
const censusHere = async (holder: Holder, localWithoutSng = false) => {
  await env.clearFirestore();
  await clearSessionScopedClientState('manual');
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  // Production's Rayen policy: schema 2 turns on the clinical write fence.
  await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
    schemaVersion: 2,
    mode: 'preview',
    revision: 7,
    clinicalBatchMode: 'enforced',
  });
  // The day as the census itself writes it: every bed present, so no repair travels along.
  const day: DailyRecord = JSON.parse(
    JSON.stringify(preparePatchedRecordPersistence(base(), date, {}).record)
  );
  if (localWithoutSng) {
    day.beds.R4.devices = ['CVC', 'SNG'];
    day.beds.R4.deviceDetails = { CVC: { note: 'base' }, SNG: { note: 'observación confirmada' } };
  }
  await admin.doc(dayPath).set(day);
  if (localWithoutSng) delete day.beds.R4.deviceDetails?.SNG;
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
  let gesture: Promise<boolean> | undefined;
  const hook = renderHook(
    () => {
      useDailyRecordQuery(date, false, 'local_only');
      const patch = usePatchDailyRecordMutation(date);
      const record = shown();
      // As the census's patchRecord sends it (useDailyRecordSyncQuery).
      const patchRecord = useCallback(
        async (partial: DailyRecordPatch, _options?: ApplyDailyRecordPatchOptions) => {
          const payload = await patch.mutateAsync({
            date,
            partial,
            options: { authoringSession: captureAuthoringSession() },
          });
          assertDailyRecordWriteAccepted(payload.result);
        },
        [patch]
      );
      const beds = useBedManagement(record, patchRecord);
      const bed = record?.beds.R4;
      const data = (holder === 'bed' ? bed : bed?.clinicalCrib) ?? createEmptyPatient('R4');
      const cell = useDevicesCellController({
        data: data as PatientData,
        onDevicesChange: vi.fn(),
        onDeviceDetailsChange: vi.fn(),
        onDeviceHistoryChange: vi.fn(),
        onDeviceBundleChange: fields => {
          gesture =
            holder === 'bed'
              ? beds.updatePatientMultiple('R4', fields)
              : beds.updateClinicalCribMultiple('R4', fields);
        },
      });
      return { cell, patchRecord };
    },
    { wrapper }
  );
  /** The nurse ticks a device in the cell and the census saves it. */
  const addDevice = async (device: string) => {
    await act(async () => {
      hook.result.current.cell.handleDevicesChange([device]);
      expect(await gesture).toBe(true);
    });
  };
  /** A later edit of the night note, through the same census patch. */
  const editNightNote = async (text: string) => {
    await act(async () => {
      await hook.result.current.patchRecord({ [night]: text } as DailyRecordPatch);
    });
  };
  return { hook, addDevice, editNightNote };
};

const devicesOf = (record: DailyRecord | undefined | null, holder: Holder) =>
  (holder === 'bed' ? record?.beds.R4 : record?.beds.R4?.clinicalCrib)?.devices;
const historyOf = (record: DailyRecord | undefined | null, holder: Holder) =>
  ((holder === 'bed' ? record?.beds.R4 : record?.beds.R4?.clinicalCrib)?.deviceInstanceHistory ??
    []) as Array<{ type?: string }>;

/** The network returns and the queue runs as the app's wake-up runs it. */
const networkBack = async () => {
  setFirestoreEnabled(true);
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

it.each([
  ['bed', false],
  ['bed', true],
  ['crib', false],
] as const)(
  'a device ticked without network in the %s reaches the server (later night note: %s)',
  async (holder, laterNote) => {
    const census = await censusHere(holder);
    try {
      setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
      await census.addDevice('CVC');
      const [queued] = await hospitalDB.syncQueue.toArray();
      const prefix = holder === 'bed' ? 'beds.R4' : 'beds.R4.clinicalCrib';
      expect(queued.syncContract?.changedPaths).toEqual(
        expect.arrayContaining([`${prefix}.devices`, `${prefix}.deviceInstanceHistory`])
      );
      expect(devicesOf(queued.payload as DailyRecord, holder)).toEqual(['CVC']);
      if (laterNote) await census.editNightNote('segunda edición');

      await networkBack();

      const stored = await server();
      expect(devicesOf(stored, holder)).toEqual(['CVC']);
      expect(historyOf(stored, holder).map(instance => instance.type)).toEqual(['CVC']);
      if (laterNote) expect(stored[night]).toBe('segunda edición');
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    } finally {
      census.hook.unmount();
    }
  },
  60_000
);

it('online, the same gesture reaches the server as a patch', async () => {
  const census = await censusHere('bed');
  try {
    setFirestoreEnabled(true);
    await census.addDevice('CVC');
    expect(devicesOf(await server(), 'bed')).toEqual(['CVC']);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  } finally {
    census.hook.unmount();
  }
}, 60_000);

// Review of #1759: a task that names one device's detail must not carry this computer's partial map
// over the other confirmed details, through either path.
it.each(['online', 'offline'] as const)(
  'a detail named for one device keeps the other confirmed details (%s)',
  async mode => {
    const census = await censusHere('bed', true);
    try {
      if (mode === 'offline') setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
      await act(async () => {
        await census.hook.result.current.patchRecord({
          'beds.R4.deviceDetails.CVC': { note: 'nueva' },
        } as DailyRecordPatch);
      });
      if (mode === 'offline') {
        const [queued] = await hospitalDB.syncQueue.toArray();
        expect(queued.syncContract?.changedPaths).toEqual(['beds.R4.deviceDetails.CVC']);
        await networkBack();
      }
      expect((await server()).beds.R4.deviceDetails).toEqual({
        CVC: { note: 'nueva' },
        SNG: { note: 'observación confirmada' },
      });
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    } finally {
      census.hook.unmount();
    }
  },
  60_000
);
