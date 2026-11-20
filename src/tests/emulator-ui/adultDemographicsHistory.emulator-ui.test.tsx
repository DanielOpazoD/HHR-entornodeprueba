/**
 * A demographic correction saved from an adult's or a mother's row reaches the same patient on
 * the day before, as main did, through the real port, queue and authority handlers (ID-01, ID-02).
 * A day saved without an episode id carries only a derived `legacy_ep_` id, which accredits
 * nothing: a single match by document or name still updates it. A document is read with its stated
 * type: a numeric passport never corrects the person whose RUT has the same digits.
 */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { act, renderHook, waitFor } from '@testing-library/react';
import { processSyncQueue } from '@/services/storage/sync';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
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

import {
  defaultDailyRecordReadPort,
  defaultDailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import { buildPatientRowRuntimeHookParams } from '@/features/census/controllers/patientRowRuntimeModelController';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { addCalendarDays } from '@/utils/clinicalDateUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
const projectId = 'demo-hhr-adult-demographics-history';
const today = getTodayISO();
let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
beforeAll(async () => {
  if (!/^127[.]0[.]0[.]1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
    throw Error('Local emulator only');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'adult-demographics-history');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  h.db = env
    .authenticatedContext('synthetic-B', {
      role: 'nurse_hospital',
      email: 'synthetic-B@example.invalid',
    })
    .firestore();
  setFirestoreEnabled(true);
  // Offline: the correction waits in the queue and each test sends it with processSyncQueue.
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
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await deleteApp(app);
});

type Scenario = {
  id: string;
  source?: string;
  prior: (string | undefined)[];
  key: 'rut' | 'nombre';
  /** Bed index whose age changes on the earlier day; null when that day is not written. */
  corrected: number | null;
  /** Stated type and document of the earlier day and of the edited row; untyped RUTs otherwise. */
  documents?: { prior: TypedDocument; edited: TypedDocument };
};
type TypedDocument = { documentType: 'RUT' | 'Pasaporte'; rut: string };
const passport = (rut: string): TypedDocument => ({ documentType: 'Pasaporte', rut });
const run = (rut: string): TypedDocument => ({ documentType: 'RUT', rut });
// Same final data as main except two cases decided on purpose: two different accredited episodes
// are a real readmission (main wrote it), and the bed of the same accredited episode wins over a
// bed without one (main wrote the first match). Ambiguous days end unchanged, as main's write was
// held by the server as a conflict; now it is not attempted. A numeric passport and the RUT of its
// digits are two people (ID-01): main wrote that day.
const scenarios: Scenario[] = [
  { id: 'the same episode', source: 'A', prior: ['A'], key: 'rut', corrected: 0 },
  {
    id: 'an earlier day without episode',
    source: 'A',
    prior: [undefined],
    key: 'rut',
    corrected: 0,
  },
  { id: 'both days without episode', prior: [undefined], key: 'rut', corrected: 0 },
  { id: 'an edited row without episode', prior: ['A'], key: 'rut', corrected: 0 },
  { id: 'a single name without document', prior: [undefined], key: 'nombre', corrected: 0 },
  { id: 'a different accredited episode', source: 'A', prior: ['B'], key: 'rut', corrected: null },
  {
    id: 'two beds without episode',
    source: 'A',
    prior: [undefined, undefined],
    key: 'rut',
    corrected: null,
  },
  {
    id: 'two beds with the same name',
    prior: [undefined, undefined],
    key: 'nombre',
    corrected: null,
  },
  { id: 'the episode twice', source: 'A', prior: ['A', 'A'], key: 'rut', corrected: null },
  {
    id: 'the episode in the second bed',
    source: 'A',
    prior: [undefined, 'A'],
    key: 'rut',
    corrected: 1,
  },
  {
    id: 'a numeric passport over the RUT of its digits',
    prior: [undefined],
    key: 'rut',
    corrected: null,
    documents: { prior: run('12.345.678-5'), edited: passport('123456785') },
  },
  {
    id: 'a RUT over the numeric passport of its digits',
    prior: [undefined],
    key: 'rut',
    corrected: null,
    documents: { prior: passport('123456785'), edited: run('12.345.678-5') },
  },
  {
    id: 'the same numeric passport in another format',
    prior: [undefined],
    key: 'rut',
    corrected: 0,
    documents: { prior: passport('12.345.678-5'), edited: passport('123456785') },
  },
];

for (const role of ['adult', 'mother'] as const) {
  for (const scenario of scenarios) {
    it(`${role}: ${scenario.id}`, async () => {
      await env.clearFirestore();
      await clearSessionScopedClientState('manual');
      await hospitalDB.dailyRecords.clear();
      await hospitalDB.syncQueue.clear();
      await reconcileAuthorizedSessionOwner('user:synthetic-B');
      await admin
        .doc('hospitals/hanga_roa/settings/rayenImportPolicy')
        .set({ schemaVersion: 2, clinicalBatchMode: 'enforced' });
      const first = addCalendarDays(today, -1);
      const targetAge = String(40 + scenarios.indexOf(scenario) + (role === 'mother' ? 10 : 0));
      const makePatient = (bedId: string, episode: string | undefined, edited: boolean) =>
        DataFactory.createMockPatient(bedId, {
          patientName:
            scenario.key === 'rut' && edited
              ? 'NOMBRE ACTUAL SINTETICO'
              : 'NOMBRE ANTERIOR SINTETICO',
          rut: scenario.key === 'nombre' ? '' : edited ? '11.111.111-1' : '11111111-1',
          ...scenario.documents?.[edited ? 'edited' : 'prior'],
          clinicalEpisodeId: episode,
          firstSeenDate: first,
          admissionDate: first,
          age: '32',
          clinicalCrib:
            role === 'mother'
              ? DataFactory.createMockPatient(bedId, {
                  patientName: 'RN SINTETICO',
                  rut: '',
                  firstSeenDate: first,
                  admissionDate: first,
                  age: '1d',
                  clinicalEpisodeId: `rn-${bedId}`,
                })
              : undefined,
        });
      const beds = Object.fromEntries(
        scenario.prior.map((episode, index) => {
          const bedId = `R${index + 1}`;
          return [bedId, makePatient(bedId, episode, false)];
        })
      );
      const seed = DataFactory.createMockDailyRecord(first, {
        beds,
        lastUpdated: new Date(Date.now() - 90_000).toISOString(),
        dateTimestamp: clinicalWallClockToDate(first, '00:00').getTime(),
      });
      const path = `hospitals/hanga_roa/dailyRecords/${first}`;
      await admin.doc(path).set(JSON.parse(JSON.stringify(seed)));
      await hospitalDB.dailyRecords.put(seed);
      const read = vi.spyOn(defaultDailyRecordReadPort, 'getForDate');
      const write = vi.spyOn(defaultDailyRecordWritePort, 'updatePartial');
      const savedToday = vi.fn(async () => true);
      const edited = makePatient('R4', scenario.source, true);
      const { result, unmount } = renderHook(() =>
        usePatientRowHandlersModel(
          buildPatientRowRuntimeHookParams({
            bed: { id: 'R4' },
            data: edited,
            isSubRow: false,
            currentDateString: today,
            rowState: {
              isCunaMode: false,
              hasCompanion: false,
              hasClinicalCrib: role === 'mother',
            },
            onAction: vi.fn(),
            dependencies: {
              updatePatient: vi.fn(),
              updatePatientMultiple: savedToday,
              clearPatient: vi.fn(),
              updateClinicalCrib: vi.fn(),
              updateClinicalCribMultiple: vi.fn(),
              toggleBedType: vi.fn(),
              confirm: vi.fn(),
              alert: vi.fn(),
            },
          }).editingRuntimeParams
        )
      );
      try {
        act(() => {
          result.current.modalSavers.onSaveDemographics({ age: targetAge });
        });
        expect(savedToday).toHaveBeenCalledWith('R4', { age: targetAge });
        await waitFor(() => expect(read).toHaveBeenCalledWith(first));
        // The history loop awaits this single read, then calls the write port synchronously.
        await read.mock.results[0].value;
        await Promise.all(write.mock.results.map(call => call.value));
        await processSyncQueue();

        const remote = (await admin.doc(path).get()).data() as DailyRecord;
        const ages = Object.keys(beds).map(bedId => remote.beds[bedId].age);
        const cribAges = Object.keys(beds).map(bedId => remote.beds[bedId].clinicalCrib?.age);
        expect(ages).toEqual(
          scenario.prior.map((_, index) => (index === scenario.corrected ? targetAge : '32'))
        );
        expect(cribAges).toEqual(scenario.prior.map(() => (role === 'mother' ? '1d' : undefined)));
        expect(write).toHaveBeenCalledTimes(scenario.corrected === null ? 0 : 1);
      } finally {
        unmount();
        read.mockRestore();
        write.mockRestore();
      }
    });
  }
}
