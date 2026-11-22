/**
 * A demographic correction saved from a crib row reaches only that newborn's episode on earlier
 * days (ID-03, ID-05), through the real port, queue and authority handlers on the emulator.
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
} from '@/services/session/sessionScopedStorageService';
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

import { defaultDailyRecordWritePort } from '@/application/ports/dailyRecordPort';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import { buildPatientRowRuntimeHookParams } from '@/features/census/controllers/patientRowRuntimeModelController';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { addCalendarDays } from '@/utils/clinicalDateUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
const projectId = 'demo-hhr-crib-demographics-history';
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
  app = initializeApp({ projectId }, 'crib-demographics-history');
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

it.each([
  ['the only newborn with that name', -1, false, '2d'],
  ['a newborn of another episode with the same name', -1, true, '2d'],
  ['a day whose nurse window already closed', -2, false, '1d'],
] as const)(
  'corrects the earlier day only for that newborn, next to %s',
  async (_case, offset, sameNameNeighbour, expectedAge) => {
    await env.clearFirestore();
    await clearSessionScopedClientState('manual');
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    await reconcileAuthorizedSessionOwner('user:synthetic-B');
    await admin
      .doc('hospitals/hanga_roa/settings/rayenImportPolicy')
      .set({ schemaVersion: 2, clinicalBatchMode: 'enforced' });
    const first = addCalendarDays(today, offset);
    const makeCrib = (episode: string) =>
      DataFactory.createMockPatient('R2', {
        patientName: 'RN DE MADRE SINTETICA',
        rut: '',
        clinicalEpisodeId: episode,
        identityStatus: 'provisional',
        firstSeenDate: first,
        admissionDate: first,
        age: '1d',
      });
    const source = makeCrib('rn-A');
    const mother = (bed: string, episode: string) =>
      DataFactory.createMockPatient(bed, {
        patientName: 'MADRE SINTETICA',
        rut: bed === 'R1' ? '11.111.111-1' : '12.345.678-5',
        clinicalEpisodeId: `mother-${bed}`,
        age: '30',
        clinicalCrib: { ...makeCrib(episode), bedId: bed },
      });
    const seed = DataFactory.createMockDailyRecord(first, {
      beds: { R1: mother('R1', 'rn-B'), R2: mother('R2', 'rn-A') },
      lastUpdated: new Date(Date.now() - 90_000).toISOString(),
      dateTimestamp: clinicalWallClockToDate(first, '00:00').getTime(),
    });
    if (!sameNameNeighbour) seed.beds.R1.clinicalCrib!.patientName = 'RN DIFERENTE';
    const path = `hospitals/hanga_roa/dailyRecords/${first}`;
    await admin.doc(path).set(JSON.parse(JSON.stringify(seed)));
    await hospitalDB.dailyRecords.put(seed);
    const update = vi.spyOn(defaultDailyRecordWritePort, 'updatePartial');
    const saved = vi.fn();
    const savedMany = vi.fn(async () => true);
    const { result, unmount } = renderHook(() =>
      usePatientRowHandlersModel(
        buildPatientRowRuntimeHookParams({
          bed: { id: 'R2' },
          data: source,
          isSubRow: true,
          currentDateString: today,
          rowState: { isCunaMode: false, hasCompanion: false, hasClinicalCrib: false },
          onAction: vi.fn(),
          dependencies: {
            updatePatient: saved,
            updatePatientMultiple: savedMany,
            clearPatient: vi.fn(),
            updateClinicalCrib: saved,
            updateClinicalCribMultiple: savedMany,
            toggleBedType: vi.fn(),
            confirm: vi.fn(),
            alert: vi.fn(),
          },
        }).editingRuntimeParams
      )
    );
    try {
      act(() => {
        result.current.modalSavers.onSaveCribDemographics({ age: '2d' });
      });
      await waitFor(() => expect(update).toHaveBeenCalled(), { timeout: 10_000 });
      await update.mock.results[0].value.catch(() => undefined);
      await processSyncQueue();

      const remote = (await admin.doc(path).get()).data() as DailyRecord;
      expect(remote.beds.R1.age).toBe('30');
      expect(remote.beds.R2.age).toBe('30');
      expect(remote.beds.R1.clinicalCrib?.age).toBe('1d');
      expect(remote.beds.R2.clinicalCrib?.age).toBe(expectedAge);
    } finally {
      unmount();
      update.mockRestore();
    }
  }
);
