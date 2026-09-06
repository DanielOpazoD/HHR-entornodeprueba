import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type { StaffObservation } from '@/services/staff/eloisaStaffIdentity';
import { mergeStaffCatalog } from '@/services/staff/eloisaStaffIdentity';
import '../../../extension/fichamedico-history-read-model.js';

let activeDb: unknown;
let localDb: Dexie;
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  get hospitalDB() {
    return localDb;
  },
  ensureDbReady: async () => {},
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => activeDb },
}));
import {
  publishSharedStaffCatalog,
  SHARED_STAFF_DOC,
} from '@/services/staff/sharedEloisaStaffCatalog';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import {
  readEloisaStaff,
  registerEloisaStaff,
  subscribeEloisaStaff,
} from '@/services/staff/eloisaStaffRegistry';
const openLocalCatalog = (name: string) => {
  const database = new Dexie(name);
  database.version(1).stores({ catalogs: 'id' });
  return database;
};
const project = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoHistoryReadModel: {
      project: (payload: unknown) => { nursingActivity: StaffObservation[] };
    };
  }
).HhrFichaMedicoHistoryReadModel.project;
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('shared staff catalog emulator', () => {
  let env: RulesTestEnvironment;
  const path = (id: string) => `hospitals/${getActiveHospitalId()}/settings/${id}`;
  beforeAll(async () => {
    const address = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    env = await initializeTestEnvironment({
      projectId: 'demo-hhr-staff-catalog',
      firestore: { ...address, rules: readFileSync('firestore.rules', 'utf8') },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    localDb = openLocalCatalog('staff-pipeline-emulator');
    await localDb.table('catalogs').clear();
    activeDb = env
      .authenticatedContext('nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), path('nurses')), {
        list: ['Personal Anterior'],
        nurses: ['Personal Anterior'],
      });
      await setDoc(doc(context.firestore(), path('tens')), {
        list: ['Tecnico Anterior'],
        tens: ['Tecnico Anterior'],
      });
    });
  });
  afterAll(async () => {
    await localDb?.delete();
    await env?.cleanup();
  });
  afterEach(() => localDb?.close());
  const names = (author: string, role = 'Enfermera') =>
    mergeEloisaStaff([], [{ author, role, recordedAt: '2026-09-01T12:00:00' }]);
  it('merges simultaneous discoveries atomically and keeps automatic provenance across retries', async () => {
    await Promise.all([
      publishSharedStaffCatalog(names('Ana Soto')),
      publishSharedStaffCatalog(names('Berta Perez', 'TENS')),
    ]);
    const reader = env
      .authenticatedContext('reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    expect((await getDoc(doc(reader, path('nurses')))).data()?.list).toEqual([
      'Personal Anterior',
      'Ana Soto',
    ]);
    expect((await getDoc(doc(reader, path('tens')))).data()?.list).toEqual([
      'Tecnico Anterior',
      'Berta Perez',
    ]);
    const previous = (await getDoc(doc(reader, path(SHARED_STAFF_DOC)))).data();
    await publishSharedStaffCatalog(names('Ana Soto'));
    expect((await getDoc(doc(reader, path(SHARED_STAFF_DOC)))).data()).toEqual(previous);
    expect(
      previous?.list.every(
        (entry: { manuallyCatalogued: boolean }) => entry.manuallyCatalogued === false
      )
    ).toBe(true);
  });
  it('does not bypass authentication or existing settings write permissions', async () => {
    activeDb = env.unauthenticatedContext().firestore();
    await expect(publishSharedStaffCatalog(names('Sin Acceso'))).rejects.toThrow();
  });
  it('carries source IDs through discovery, shared publication and reopened local storage', async () => {
    const payload = [
      {
        publishDatetime: '2026-09-05T12:00:00',
        evolutionResume: [
          {
            HCP_FGN: 'Ana',
            HCP_FFN: 'Soto',
            HCP_SFN: 'Rojas',
            HCPR_NAME: 'Enfermera',
            authorHealthCarePractitionerId: 'staff-a',
          },
          { HCP_NAME: 'Ana Soto', HCPR_NAME: 'Enfermera', healthCarePractitionerId: 'staff-a' },
          { HCP_NAME: 'Ana Soto Rojas', HCPR_NAME: 'TENS', HCP_ID: 'staff-t' },
        ],
      },
    ];
    const original = structuredClone(payload);
    const observations = project(payload).nursingActivity;
    expect(observations.map(row => row.practitionerId)).toEqual(['staff-a', 'staff-a', 'staff-t']);
    const registered = await registerEloisaStaff(observations);
    expect(registered).toHaveLength(3);
    registered.forEach(row =>
      expect(row).toEqual(
        expect.objectContaining({
          resolvedStaffIdentity: expect.objectContaining({
            name: 'Ana Soto Rojas',
            catalogMatched: false,
          }),
        })
      )
    );
    const confirmed = await readEloisaStaff();
    expect(confirmed).toEqual([
      expect.objectContaining({
        key: 'nurse:id:staff-a',
        practitionerId: 'staff-a',
        role: 'nurse',
        name: 'Ana Soto Rojas',
        aliases: expect.arrayContaining(['Ana Soto']),
      }),
      expect.objectContaining({
        key: 'tens:id:staff-t',
        practitionerId: 'staff-t',
        role: 'tens',
        name: 'Ana Soto Rojas',
      }),
    ]);
    const reader = env
      .authenticatedContext('reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    const sharedRef = doc(reader, path(SHARED_STAFF_DOC));
    const remote = (await getDoc(sharedRef)).data();
    expect(remote?.list).toEqual(confirmed);
    expect((await getDoc(doc(reader, path('nurses')))).data()?.list).toEqual(
      mergeStaffCatalog(['Personal Anterior'], confirmed, 'nurse')
    );
    expect((await getDoc(doc(reader, path('tens')))).data()?.list).toEqual(
      mergeStaffCatalog(['Tecnico Anterior'], confirmed, 'tens')
    );
    localDb.close();
    localDb = openLocalCatalog('staff-pipeline-emulator');
    expect(await readEloisaStaff()).toEqual(confirmed);
    await registerEloisaStaff(observations);
    expect((await getDoc(sharedRef)).data()).toEqual(remote);
    expect(await readEloisaStaff()).toEqual(confirmed);
    expect(confirmed.every(entry => entry.manuallyCatalogued === false)).toBe(true);
    expect(payload).toEqual(original);
    localDb.close();
    localDb = openLocalCatalog('staff-pipeline-fresh-reader');
    await localDb.table('catalogs').clear();
    expect(await readEloisaStaff()).toEqual([]);
    const next = vi.fn(),
      error = vi.fn();
    const unsubscribe = subscribeEloisaStaff(next, error, true);
    try {
      await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(confirmed));
      expect(await readEloisaStaff()).toEqual(confirmed);
      expect(error).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      await localDb.delete();
    }
  });
  it('preserves separate source identities when a later discovery makes a short alias ambiguous', async () => {
    const observation = (author: string, practitionerId?: string): StaffObservation => ({
      author,
      practitionerId,
      role: 'Enfermera',
      recordedAt: '2026-09-05T12:00:00',
      authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Soto' },
    });
    await registerEloisaStaff([observation('Ana Soto Rojas', 'staff-a')]);
    const unambiguous = await registerEloisaStaff([observation('Ana Soto')]);
    expect(unambiguous[0]).toEqual(
      expect.objectContaining({
        resolvedStaffIdentity: expect.objectContaining({
          key: 'nurse:id:staff-a',
          name: 'Ana Soto Rojas',
        }),
      })
    );
    const second = observation('Ana Soto Perez', 'staff-b');
    await registerEloisaStaff([second]);
    const short = await registerEloisaStaff([observation('Ana Soto')]);
    expect(short[0]).toEqual(expect.objectContaining({ resolvedStaffIdentity: undefined }));
    const entries = await readEloisaStaff();
    expect(entries).toHaveLength(3);
    expect(
      entries.filter(entry => entry.practitionerId).map(entry => entry.practitionerId)
    ).toEqual(['staff-a', 'staff-b']);
    await registerEloisaStaff([second]);
    expect(await readEloisaStaff()).toEqual(entries);
  });
  it('does not report a failed shared publication as success and converges when retried', async () => {
    const authenticatedDb = activeDb;
    activeDb = env.unauthenticatedContext().firestore();
    const observations = [
      {
        author: 'Nueva Persona',
        role: 'TENS',
        recordedAt: '2026-09-05T12:00:00',
        practitionerId: 'staff-new',
      },
    ];
    await expect(registerEloisaStaff(observations)).rejects.toThrow();
    expect(await readEloisaStaff()).toHaveLength(1);
    activeDb = authenticatedDb;
    await registerEloisaStaff(observations);
    await registerEloisaStaff(observations);
    const reader = env
      .authenticatedContext('reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    expect((await getDoc(doc(reader, path(SHARED_STAFF_DOC)))).data()?.list).toEqual(
      await readEloisaStaff()
    );
    expect((await getDoc(doc(reader, path('tens')))).data()?.list).toEqual([
      'Tecnico Anterior',
      'Nueva Persona',
    ]);
  });
});
