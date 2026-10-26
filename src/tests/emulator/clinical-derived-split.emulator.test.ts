import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  DAY,
  PRIOR_DAY,
  RUN_ID,
  SPLIT_ENV,
  checkpoint,
  createDailyRecordWriteAuthorityFunctions,
  createRayenClinicalEnrichmentFunctions,
  episodeDoc,
  guardedPatch,
  makeContext,
  makeDay,
  marker,
  shadowPolicy,
  vitals,
} from '@/tests/functions/clinicalDerivedServer.test-support';

type Data = FirebaseFirestore.DocumentData;

const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST;

// Phase 1a P5 on a real Firestore: the SDK enforces reads before writes, dotted update paths with
// FieldValue.delete() and exclusive creates. Synthetic data only, local emulator only.
(enabled ? describe : describe.skip)('phase 1a server split on Firestore', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const dayDoc = (date = DAY) => db.doc(`${hospital}/dailyRecords/${date}`);
  const episodeRef = (episodeId: string, date = DAY) =>
    dayDoc(date).collection('clinicalDerived').doc(episodeId);
  const read = async (date = DAY) => (await dayDoc(date).get()).data() as Data;
  const version = async (date = DAY) => {
    const value = (await read(date)).lastUpdated;
    return value instanceof Timestamp ? value.toDate().toISOString() : String(value);
  };
  const api = (role: string) => {
    const dependencies = {
      firestore: db,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: vi.fn().mockResolvedValue(role),
    };
    return {
      ...createDailyRecordWriteAuthorityFunctions(dependencies),
      ...createRayenClinicalEnrichmentFunctions(dependencies),
    };
  };

  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
      throw new Error('Local emulator required');
    }
    app = initializeApp({ projectId: 'demo-hhr-clinical-derived-split' }, 'clinical-derived-split');
    db = getFirestore(app);
    // Warm the client up outside the per-test hooks: the first RPC pays the cold start.
    await db.doc(hospital).get();
  }, 60_000);
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  beforeEach(async () => {
    await db.recursiveDelete(db.doc(hospital));
    // Pin the hospital day while the real Firestore transport keeps its own timers.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('splits through the guarded patch, the batch and a full save, with recoverable run copies', async () => {
    await db.doc(`${hospital}/settings/rayenImportPolicy`).set(shadowPolicy);
    await dayDoc().set(makeDay());
    const nurse = api('nurse_hospital');
    const patch = async (body: Data, mutationId: string, overrides: Data = {}) =>
      nurse.patchDailyRecordWithClinicalAuthority.run(
        guardedPatch(body, {
          expectedLastUpdated: await version(),
          syncContract: { mutationId, changedPaths: Object.keys(body) },
          ...overrides,
        }),
        makeContext()
      );

    // 1. First moved-field write: marks the day, deletes both embedded copies, writes the doc.
    const first = await patch({ 'beds.R2.vitalSignsHistory': [vitals(DAY, 72)] }, 'm-1');
    let day = await read();
    const generation = day.clinicalDerivedLayout.generation;
    expect(day.clinicalDerivedLayout).toEqual({ version: 1, generation: expect.any(String) });
    expect(day.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(day.beds.R1.vitalSignsHistory).toEqual([vitals(PRIOR_DAY, 80)]);
    expect((await episodeRef('ep_pasaporte_2').get()).data()).toMatchObject({
      layoutGeneration: generation,
      dayRevision: 8,
      vitalSignsHistory: [vitals(DAY, 72)],
      clinicalSyncCheckpoint: checkpoint('p-1'),
    });
    expect(first.recordState.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(first.recordState.record.clinicalDerivedLayout).toEqual(day.clinicalDerivedLayout);

    // 2. Same run, another episode: the existing run copy gains it with a dotted update.
    await patch({ 'beds.R1.vitalSignsHistory': [vitals(DAY, 90)] }, 'm-2');
    const runCopy = (await dayDoc().collection('history').doc(`rayen-${RUN_ID}`).get()).data();
    expect(Object.keys(runCopy?.clinicalDerivedPrevious ?? {}).sort()).toEqual([
      'ep_madre_1',
      'ep_pasaporte_2',
    ]);
    expect(runCopy?.clinicalDerivedPrevious.ep_madre_1.embedded.vitalSignsHistory).toEqual([
      vitals(PRIOR_DAY, 80),
    ]);

    // 3. A lost-response retry from an older client is answered from the receipt, untouched.
    const before = await dayDoc().get();
    const retry = await patch({ 'beds.R1.vitalSignsHistory': [vitals(DAY, 90)] }, 'm-2', {
      expectedLastUpdated: undefined,
      clientRuntimeContractVersion: undefined,
    });
    expect(retry.authorityStatus).toBe('idempotent');
    expect((await dayDoc().get()).updateTime?.isEqual(before.updateTime!)).toBe(true);

    // 4. A new client write from an older client is refused.
    await expect(
      patch({ 'beds.R2.clinicalSyncCheckpoint': checkpoint('p-x') }, 'm-3', {
        clientRuntimeContractVersion: 2,
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // 5. Enforced batch of a later run: combined view, day from the remote, documents revised.
    await db
      .doc(`${hospital}/settings/rayenImportPolicy`)
      .set({ ...shadowPolicy, revision: 5, clinicalBatchMode: 'enforced' });
    await dayDoc().update({
      rayenSyncHistory: FieldValue.arrayUnion({
        id: 'run-synthetic-2',
        status: 'applied',
        sourceDate: DAY,
        policy: { mode: 'preview', revision: 5, clinicalBatchMode: 'enforced' },
      }),
    });
    const batch = await api('nurse_hospital').applyRayenClinicalEnrichmentBatch.run(
      {
        date: DAY,
        authorityDate: DAY,
        runId: 'run-synthetic-2',
        mutationId: 'batch-1',
        expectedLastUpdated: await version(),
        baseRevision: 9,
        fieldContractVersion: 2,
        mode: 'enforced',
        patches: [
          {
            bedId: 'R2',
            clinicalEpisodeId: 'ep_pasaporte_2',
            fields: { vitalSignsHistory: [vitals(DAY, 74), vitals(DAY, 72)] },
          },
        ],
        checkpoints: [
          { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: checkpoint('p-2') },
        ],
        clientRuntimeContractVersion: 3,
      },
      makeContext()
    );
    expect(batch).toMatchObject({ authorityStatus: 'ok', revision: 10, historySnapshots: 1 });
    day = await read();
    expect(day.clinicalDerivedLayout.generation).toBe(generation);
    expect(day.beds.R1).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect((await episodeRef('ep_pasaporte_2').get()).data()).toMatchObject({
      dayRevision: 10,
      lastMutationId: 'batch-1',
      clinicalSyncCheckpoint: checkpoint('p-2'),
      vitalSignsHistory: [vitals(DAY, 74), vitals(DAY, 72)],
    });
    const batchCopies = await dayDoc()
      .collection('history')
      .where('snapshotReason', '==', 'rayen_clinical_enrichment')
      .get();
    expect(batchCopies.docs).toHaveLength(1);
    expect(batchCopies.docs[0].data().clinicalDerivedPrevious.ep_pasaporte_2.document).toEqual({
      layoutGeneration: generation,
      date: DAY,
      vitalSignsHistory: [vitals(DAY, 72)],
      clinicalSyncCheckpoint: checkpoint('p-1'),
    });
    expect(batchCopies.docs[0].data().beds.R1.clinicalCrib.vitalSignsHistory).toEqual([
      vitals(PRIOR_DAY, 140),
    ]);

    // 5b. A later chunk of that run splits the newborn: its value moves out of the copy's crib.
    await api('nurse_hospital').applyRayenClinicalEnrichmentBatch.run(
      {
        date: DAY,
        authorityDate: DAY,
        runId: 'run-synthetic-2',
        mutationId: 'batch-2',
        expectedLastUpdated: await version(),
        baseRevision: 10,
        fieldContractVersion: 2,
        mode: 'enforced',
        patches: [
          {
            bedId: 'R1',
            clinicalCrib: true,
            clinicalEpisodeId: 'ep_rn_1',
            fields: { vitalSignsHistory: [vitals(DAY, 150)] },
          },
        ],
        checkpoints: [],
        clientRuntimeContractVersion: 3,
      },
      makeContext()
    );
    const extended = (await batchCopies.docs[0].ref.get()).data();
    expect(extended?.beds.R1.clinicalCrib).not.toHaveProperty('vitalSignsHistory');
    expect(extended?.clinicalDerivedPrevious.ep_rn_1).toEqual({
      embedded: { vitalSignsHistory: [vitals(PRIOR_DAY, 140)], clinicalSyncCheckpoint: null },
    });
    expect(Object.keys(extended?.clinicalDerivedPrevious ?? {}).sort()).toEqual([
      'ep_pasaporte_2',
      'ep_rn_1',
    ]);

    // 6. A full save at the read revision carries stale clinical fields; the server keeps the split.
    const base = await read();
    const stale = makeDay();
    (stale.beds as Record<string, Data>).R2.pathology = 'Cambio estructural';
    await api('admin').saveDailyRecordWithClinicalAuthority.run(
      {
        date: DAY,
        mode: 'shadow',
        record: stale,
        syncContract: { baseRevision: base.meta.revision },
      },
      makeContext()
    );
    day = await read();
    expect(day.clinicalDerivedLayout.generation).toBe(generation);
    expect(day.beds.R2.pathology).toBe('Cambio estructural');
    expect(day.beds.R1).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R1.clinicalCrib).not.toHaveProperty('vitalSignsHistory');
    expect((await dayDoc().collection('clinicalDerived').get()).size).toBe(3);
  });

  it("keeps a deleted day's episode document when the restored day's first split write replaces it", async () => {
    await db.doc(`${hospital}/settings/rayenImportPolicy`).set(shadowPolicy);
    await dayDoc().set(makeDay());
    await api('nurse_hospital').patchDailyRecordWithClinicalAuthority.run(
      guardedPatch({ 'beds.R2.vitalSignsHistory': [vitals(DAY, 72), vitals(PRIOR_DAY, 70)] }),
      makeContext()
    );
    const backupDay = await read();
    const leftover = (await episodeRef('ep_pasaporte_2').get()).data();
    await dayDoc().delete();

    // The full save writes no episode document: the restored day gets a new generation.
    await api('admin').saveDailyRecordWithClinicalAuthority.run(
      {
        date: DAY,
        mode: 'shadow',
        origin: 'backup_restore',
        record: backupDay,
        clientRuntimeContractVersion: 3,
      },
      makeContext()
    );
    const restored = await read();
    expect(restored.clinicalDerivedLayout.generation).not.toBe(leftover?.layoutGeneration);
    expect((await episodeRef('ep_pasaporte_2').get()).data()).toEqual(leftover);

    // A checkpoint-only batch keeps no run copy, and its document id is the episode's.
    await db
      .doc(`${hospital}/settings/rayenImportPolicy`)
      .set({ ...shadowPolicy, revision: 5, clinicalBatchMode: 'enforced' });
    await dayDoc().update({
      rayenSyncHistory: FieldValue.arrayUnion({
        id: 'run-synthetic-2',
        status: 'applied',
        sourceDate: DAY,
        policy: { mode: 'preview', revision: 5, clinicalBatchMode: 'enforced' },
      }),
    });
    await api('nurse_hospital').applyRayenClinicalEnrichmentBatch.run(
      {
        date: DAY,
        authorityDate: DAY,
        runId: 'run-synthetic-2',
        mutationId: 'batch-after-restore',
        expectedLastUpdated: await version(),
        baseRevision: restored.meta.revision,
        fieldContractVersion: 2,
        mode: 'enforced',
        patches: [],
        checkpoints: [
          { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: checkpoint('p-9') },
        ],
        clientRuntimeContractVersion: 3,
      },
      makeContext()
    );

    expect((await episodeRef('ep_pasaporte_2').get()).data()).toMatchObject({
      layoutGeneration: restored.clinicalDerivedLayout.generation,
      clinicalSyncCheckpoint: checkpoint('p-9'),
    });
    const copies = await dayDoc()
      .collection('history')
      .where('snapshotReason', '==', 'clinical_derived_displaced')
      .get();
    expect(copies.docs.map(copy => copy.data().clinicalDerivedPrevious)).toEqual([
      { ep_pasaporte_2: { document: leftover } },
    ]);
  });

  it('creates today marked and seeds its carryover from the split prior day', async () => {
    await db.doc(`${hospital}/settings/rayenImportPolicy`).set(shadowPolicy);
    const prior = makeDay({
      date: PRIOR_DAY,
      lastUpdated: `${PRIOR_DAY}T10:00:00.000Z`,
      clinicalDerivedLayout: marker('gen-prior'),
    });
    delete (prior.beds as Record<string, Data>).R2.vitalSignsHistory;
    await dayDoc(PRIOR_DAY).set(prior);
    await episodeRef('ep_pasaporte_2', PRIOR_DAY).set(
      episodeDoc('ep_pasaporte_2', {
        date: PRIOR_DAY,
        layoutGeneration: 'gen-prior',
        vitalSignsHistory: [vitals(PRIOR_DAY, 66)],
      })
    );
    const request = makeDay({ clinicalDerivedLayout: { version: 1, generation: 'client-forged' } });
    const r2 = (request.beds as Record<string, Data>).R2;
    delete r2.vitalSignsHistory;
    r2.clinicalCarryover = { sourceDate: PRIOR_DAY };

    await api('admin').saveDailyRecordWithClinicalAuthority.run(
      // No client version: under the Rayen fence the server reseeds the moved fields itself.
      { date: DAY, mode: 'shadow', record: request },
      makeContext()
    );

    const day = await read();
    expect(day.clinicalDerivedLayout.generation).not.toMatch(/client-forged|gen-prior/);
    expect(day.beds.R2.vitalSignsHistory).toEqual([vitals(PRIOR_DAY, 66)]);
    expect((await dayDoc().collection('clinicalDerived').get()).empty).toBe(true);
  });
});
