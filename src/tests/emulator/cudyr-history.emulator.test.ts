import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  CudyrHistoryCursor,
  CudyrHistoryObservation,
  ReadCudyrHistoryResult,
} from '@/types/domain/cudyrHistory';

import type { ReadCudyrCapturesResult } from '@/types/domain/cudyrCapture';

const require = createRequire(import.meta.url);
// Use the same Admin SDK instance as the callable implementation after separate npm installs.
const requireFunctions = createRequire(new URL('../../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions(
  'firebase-admin/app'
) as typeof import('firebase-admin/app');
const { getFirestore } = requireFunctions(
  'firebase-admin/firestore'
) as typeof import('firebase-admin/firestore');
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

  it('stores idempotent capture receipts, keeps empty/unavailable distinct and reads every page', async () => {
    const fns = createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'nurse_hospital',
      hasCallableClinicalAccess: async () => true,
    });
    const capture = {
      id: '00000000-0000-4000-8000-000000000001',
      clinicalEpisodeId: evaluation.clinicalEpisodeId,
      sourceRunId: payload.runId,
      observedAt: '2026-10-06T20:00:00.000Z',
      status: 'observed',
      metadataStatus: 'partial',
      part: 0,
      totalParts: 1,
      totalEvaluations: 1,
    };
    const replies = await Promise.all(
      [1, 2].map(() => fns.archiveCudyrHistory.run({ ...payload, capture }, context))
    );
    expect(replies[0].captureReceiptId).toBe(replies[1].captureReceiptId);
    await fns.archiveCudyrHistory.run(
      {
        ...payload,
        evaluations: [],
        capture: {
          ...capture,
          id: '00000000-0000-4000-8000-000000000002',
          status: 'unavailable',
          totalEvaluations: 0,
          metadataStatus: 'unknown',
        },
      },
      context
    );
    const first: ReadCudyrCapturesResult = await fns.readCudyrHistory.run(
      { ...query, kind: 'captures' },
      context
    );
    const second: ReadCudyrCapturesResult = await fns.readCudyrHistory.run(
      { ...query, kind: 'captures', cursor: first.nextCursor },
      context
    );
    const receipts = [...first.captures, ...second.captures];
    expect(receipts).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(receipts.map(row => row.capture.status).sort()).toEqual(['observed', 'unavailable']);
    const observed = receipts.find(row => row.capture.status === 'observed')!;
    expect(observed.observationIds).toEqual([replies[0].results[0].id]);
    expect(observed.captureContexts[0].section).toBe('discharges');
    await expect(
      fns.archiveCudyrHistory.run(
        { ...payload, capture: { ...capture, metadataStatus: 'unknown' } },
        context
      )
    ).rejects.toMatchObject({ code: 'already-exists' });
    expect((await db.collection(`${hospital}/cudyrCaptures`).get()).size).toBe(2);
  });
  it('serializes competing sibling manifests in a real transaction', async () => {
    const fns = createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'admin',
      hasCallableClinicalAccess: async () => true,
    });
    const capture = {
      id: '00000000-0000-4000-8000-000000000003',
      clinicalEpisodeId: evaluation.clinicalEpisodeId,
      sourceRunId: payload.runId,
      observedAt: '2026-10-06T20:00:00.000Z',
      status: 'observed',
      metadataStatus: 'partial',
    };
    const evaluations = Array.from({ length: 32 }, (_, index) => ({
      ...evaluation,
      sourceEvaluationId: `multipart-${index}`,
    }));
    const outcomes = await Promise.allSettled([
      fns.archiveCudyrHistory.run(
        {
          ...payload,
          evaluations,
          capture: { ...capture, part: 0, totalEvaluations: 65, totalParts: 3 },
        },
        context
      ),
      fns.archiveCudyrHistory.run(
        {
          ...payload,
          evaluations: [{ ...evaluation, sourceEvaluationId: 'multipart-last' }],
          capture: { ...capture, part: 1, totalEvaluations: 33, totalParts: 2 },
        },
        context
      ),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({
      reason: { code: 'already-exists' },
    });
    expect(
      (await db.collection(`${hospital}/cudyrCaptures`).where('capture.id', '==', capture.id).get())
        .size
    ).toBe(1);
  });

  it('preserves bed intervals and reads all episode pages even when captured after the report day', async () => {
    const fns = createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'nurse_hospital',
      hasCallableClinicalAccess: async () => true,
    });
    const sourcePlacements = [
      {
        clinicalEpisodeId: evaluation.clinicalEpisodeId,
        sourceMappingId: 'mapping-test',
        sourceBedId: 'source-bed',
        sourceBedLabel: 'CH1C1',
        sourceDepartmentId: 'department',
        sourceDepartmentLabel: 'Cuna',
        sourceVersion: 'opaque',
        sourceStartAt: '2026-10-01T10:00:00-05:00',
        sourceEndAt: '2026-10-03T15:00:00-05:00',
        currentAssignment: false,
        isDeleted: false,
        bedId: 'H1C1',
        modality: 'cuna',
      },
    ];
    const result = await fns.archiveCudyrHistory.run(
      {
        ...payload,
        capture: {
          id: '00000000-0000-4000-8000-000000000004',
          clinicalEpisodeId: evaluation.clinicalEpisodeId,
          sourceRunId: payload.runId,
          observedAt: '2026-10-06T20:00:00.000Z',
          status: 'observed',
          metadataStatus: 'partial',
          part: 0,
          totalParts: 1,
          totalEvaluations: 1,
          sourcePlacements,
        },
      },
      context
    );
    const read = {
      kind: 'episode-captures',
      clinicalEpisodeIds: [evaluation.clinicalEpisodeId],
      limit: 1,
    };
    const captures: ReadCudyrCapturesResult['captures'] = [];
    let cursor: CudyrHistoryCursor | null = null;
    do {
      const page: ReadCudyrCapturesResult = await fns.readCudyrHistory.run(
        { ...read, ...(cursor ? { cursor } : {}) },
        context
      );
      captures.push(...page.captures);
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(captures.map(item => item.id)).size).toBe(captures.length);
    expect(
      captures.find(item => item.id === result.captureReceiptId)?.capture.sourcePlacements
    ).toEqual(sourcePlacements);
    expect(
      (await fns.readCudyrHistory.run({ ...read, clinicalEpisodeIds: ['other-episode'] }, context))
        .captures
    ).toEqual([]);
    await expect(fns.readCudyrHistory.run(read, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const denied = createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'viewer',
      hasCallableClinicalAccess: async () => false,
    });
    await expect(denied.readCudyrHistory.run(read, context)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
