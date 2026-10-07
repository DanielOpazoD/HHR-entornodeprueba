import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type {
  CudyrHistoryCursor,
  CudyrHistoryObservation,
  ReadCudyrHistoryResult,
} from '@/types/domain/cudyrHistory';

const require = createRequire(import.meta.url);
const { createCudyrHistoryFunctions } = require('../../../functions/lib/cudyrHistoryFunctions.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;

describeEmulator('permanent CUDYR observations in Firestore', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const date = '2026-10-06';
  const context = { auth: { uid: 'synthetic-user', token: { email: 'test@example.com' } } };
  const evaluation = {
    clinicalEpisodeId: 'synthetic-episode',
    sourceEvaluationId: 'synthetic-event',
    source: 'gestion_camas',
    recordedAt: '2026-10-06T03:00:00-05:00',
    category: 'C2',
    authorId: 'synthetic-author',
    author: 'Autor sintético',
  };
  const payload = {
    schemaVersion: 1,
    authorityDate: date,
    runId: 'synthetic-run',
    evaluations: [evaluation],
  };
  const query = { from: '2026-10-01', to: '2026-10-31', limit: 1 };

  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
      throw new Error('CUDYR integration requires a local emulator.');
    }
    app = initializeApp({ projectId: 'demo-hhr-cudyr-history' }, 'cudyr-history');
    db = getFirestore(app);
    const policy = {
      schemaVersion: 2,
      mode: 'preview',
      clinicalBatchMode: 'enforced',
      revision: 1,
    };
    await db.doc(`${hospital}/settings/rayenImportPolicy`).set(policy);
    await db.doc(`${hospital}/dailyRecords/${date}`).set({
      date,
      beds: {},
      // The patient has already left the bed during structural synchronization.
      discharges: [
        {
          clinicalEpisodeId: evaluation.clinicalEpisodeId,
          patientName: 'Paciente sintético',
          rut: 'synthetic-document',
          bedId: 'R1',
          originalData: { admissionDate: '2026-10-01' },
        },
      ],
      rayenSyncHistory: [{ id: payload.runId, sourceDate: date, status: 'applied', policy }],
    });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it('survives concurrent replay and preserves divergent, late and metadata-incomplete observations', async () => {
    const fns = createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'admin',
      hasCallableClinicalAccess: async () => true,
    });
    const record = await db.doc(`${hospital}/dailyRecords/${date}`).get();
    const responses = await Promise.all([
      fns.archiveCudyrHistory.run(payload, context),
      fns.archiveCudyrHistory.run(payload, context),
    ]);
    expect(responses.every(r => r.persisted)).toBe(true);
    expect(
      responses.flatMap(r => r.results.map((item: { status: string }) => item.status)).sort()
    ).toEqual(['already-recorded', 'recorded']);
    const firstPage = await fns.readCudyrHistory.run(query, context);
    expect(firstPage.observations).toHaveLength(1);
    expect(firstPage.nextCursor).toBeNull();
    const original = firstPage.observations[0];
    expect(original.captureContexts[0].section).toBe('discharges');
    await fns.archiveCudyrHistory.run(
      {
        ...payload,
        evaluations: [
          { ...evaluation, author: '', authorId: '' },
          { ...evaluation, category: 'D3', sourceVersion: 'opaque-v2' },
          {
            ...evaluation,
            sourceEvaluationId: 'earlier-event',
            recordedAt: '2026-10-03T03:00:00-05:00',
          },
          { ...evaluation, isDeleted: true },
        ],
      },
      context
    );
    // The old response may arrive again; it cannot replace any later observation.
    await fns.archiveCudyrHistory.run(payload, context);
    const observations: CudyrHistoryObservation[] = [];
    let cursor: CudyrHistoryCursor | null = null;
    do {
      const page: ReadCudyrHistoryResult = await fns.readCudyrHistory.run(
        { ...query, ...(cursor ? { cursor } : {}) },
        context
      );
      observations.push(...page.observations);
      cursor = page.nextCursor;
    } while (cursor);
    expect(observations).toHaveLength(5);
    expect(new Set(observations.map(row => row.id)).size).toBe(5);
    expect(new Set(observations.map(row => row.eventKey)).size).toBe(2);
    expect(observations.find(row => row.id === original.id)).toMatchObject({
      firstCapturedAt: original.firstCapturedAt,
      evaluation: { author: 'Autor sintético', category: 'C2' },
    });
    expect(observations.some(row => row.censusDate === '2026-10-02')).toBe(true);
    expect((await db.doc(`${hospital}/dailyRecords/${date}`).get()).data()).toEqual(record.data());
    // Invalid authority cannot produce an archive observation.
    await expect(
      fns.archiveCudyrHistory.run({ ...payload, runId: 'unconfirmed-run' }, context)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection(`${hospital}/cudyrHistory`).get()).size).toBe(5);
  });
});
