import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { HospitalConfigService } from '@/services/config/HospitalConfigService';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));
import {
  readClinicalDerivedEpisodeDocs,
  readClinicalDerivedEpisodeDoc,
  readClinicalDerivedDaySnapshot,
} from '@/services/storage/firestore/clinicalDerivedEpisodeReader';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const path = `hospitals/hanga_roa/dailyRecords/${DATE}`;
const episode = (clinicalEpisodeId: string, fields: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId,
  layoutGeneration: GENERATION,
  dayRevision: 3,
  vitalSignsHistory: null,
  ...fields,
});
const day = {
  date: DATE,
  beds: {},
  meta: { revision: 4 },
  clinicalDerivedLayout: { version: 1, generation: GENERATION },
};
const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeEmulator('clinical derived reader against real Firestore', () => {
  let environment: RulesTestEnvironment;
  beforeAll(async () => {
    const config = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    if (!['127.0.0.1', 'localhost'].includes(config.host))
      throw new Error('Local emulator required');
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-n5d2-reader',
      firestore: config,
    });
    activeDb = environment
      .authenticatedContext('synthetic-n5d2', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });
  beforeEach(async () => {
    HospitalConfigService.setHospitalId('hanga_roa');
    await environment.clearFirestore();
  });
  afterAll(async () => {
    await environment?.cleanup();
  });
  const seed = (entries: Array<[string, Record<string, unknown>]>) =>
    environment.withSecurityRulesDisabled(async context => {
      const batch = context.firestore().batch();
      for (const [suffix, data] of entries) batch.set(context.firestore().doc(path + suffix), data);
      await batch.commit();
    });
  it('reads all episodes under the requested day and confirms an empty collection', async () => {
    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION, { source: 'server' })).toEqual({
      status: 'resolved',
      docs: [],
      fromCache: false,
    });
    await seed([
      ['/clinicalDerived/ep_a', episode('ep_a')],
      ['/clinicalDerived/ep_b', episode('ep_b')],
    ]);
    for (const source of ['default', 'server'] as const) {
      expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION, { source })).toEqual({
        status: 'resolved',
        docs: [episode('ep_a'), episode('ep_b')],
        fromCache: false,
      });
      expect(await readClinicalDerivedEpisodeDocs('2026-11-03', GENERATION, { source })).toEqual({
        status: 'resolved',
        docs: [],
        fromCache: false,
      });
    }
  });
  it.each([
    ['schema', 'ep_a', episode('ep_a', { schemaVersion: 2 })],
    ['identity', 'ep_other', episode('ep_a')],
  ])('fails the entire collection and single read on invalid %s', async (_label, id, data) => {
    await seed([
      ['/clinicalDerived/ep_ok', episode('ep_ok')],
      [`/clinicalDerived/${id}`, data],
    ]);
    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'failed',
      code: 'invalid_document',
    });
    expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, id)).toEqual({
      status: 'failed',
      code: 'invalid_document',
    });
  });
  it('ignores malformed leftovers from another generation or date before validation', async () => {
    await seed([
      ['/clinicalDerived/ep_ok', episode('ep_ok')],
      [
        '/clinicalDerived/ep_old',
        episode('ep_old', { layoutGeneration: 'gen_deleted', dayRevision: -1 }),
      ],
      ['/clinicalDerived/ep_moved', episode('ep_moved', { date: '2026-11-01', schemaVersion: 9 })],
    ]);
    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'resolved',
      docs: [episode('ep_ok')],
      fromCache: false,
    });
    for (const id of ['ep_old', 'ep_moved'])
      expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, id)).toEqual({
        status: 'resolved',
        doc: null,
        fromCache: false,
      });
  });
  it('reads an episode and confirms a missing document', async () => {
    await seed([['/clinicalDerived/ep_a', episode('ep_a')]]);
    for (const source of ['default', 'server'] as const) {
      expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_a', { source })).toEqual({
        status: 'resolved',
        doc: episode('ep_a'),
        fromCache: false,
      });
      expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_b', { source })).toEqual({
        status: 'resolved',
        doc: null,
        fromCache: false,
      });
    }
  });
  it('identifies offline cache answers and refuses strict server reads offline', async () => {
    const db = environment
      .authenticatedContext('synthetic-offline', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    const previous = activeDb;
    activeDb = db;
    try {
      await seed([['/clinicalDerived/ep_a', episode('ep_a')]]);
      await readClinicalDerivedEpisodeDocs(DATE, GENERATION, { source: 'server' });
      await db.disableNetwork();
      expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
        status: 'resolved',
        docs: [episode('ep_a')],
        fromCache: true,
      });
      expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_a')).toMatchObject({
        status: 'resolved',
        fromCache: true,
      });
      expect(
        await readClinicalDerivedEpisodeDocs(DATE, GENERATION, { source: 'server' })
      ).toMatchObject({ status: 'failed' });
    } finally {
      await db.enableNetwork();
      activeDb = previous;
    }
  });
  it('returns a coherent day and only current documents using the real record mapper', async () => {
    await seed([
      ['', day],
      ['/clinicalDerived/ep_a', episode('ep_a')],
      ['/clinicalDerived/ep_old', episode('ep_old', { layoutGeneration: 'gen_deleted' })],
    ]);
    const result = await readClinicalDerivedDaySnapshot(DATE);
    expect(result).toMatchObject({ status: 'resolved', day, docs: [episode('ep_a')] });
    if (result.status === 'resolved') expect(result.day.beds.R1.patientName).toBe('');
  });
  it('distinguishes a missing day from an unmarked day with leftover documents', async () => {
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({ status: 'missing' });
    await seed([
      ['', { date: DATE, beds: {}, meta: { revision: 4 } }],
      ['/clinicalDerived/ep_a', episode('ep_a')],
    ]);
    expect(await readClinicalDerivedDaySnapshot(DATE)).toMatchObject({
      status: 'resolved',
      day: { date: DATE },
      docs: [],
    });
  });
});
