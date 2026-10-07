import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCudyrHistoryFunctions } = require('../../../functions/lib/cudyrHistoryFunctions.js');
const evaluation = {
  clinicalEpisodeId: 'episode-test',
  sourceEvaluationId: 'event-test',
  source: 'gestion_camas',
  recordedAt: '2026-10-06T03:00:00-05:00',
  category: 'C2',
  author: 'Autor prueba',
};
const payload = {
  schemaVersion: 1,
  authorityDate: '2026-10-06',
  runId: 'run-test',
  evaluations: [evaluation],
};
const context = { auth: { uid: 'test-user', token: { email: 'test@example.com' } } };

const harness = () => {
  const policy = { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 };
  const record = {
    date: payload.authorityDate,
    beds: { R1: { clinicalEpisodeId: 'episode-test', patientName: 'Paciente prueba' } },
    rayenSyncHistory: [
      { id: payload.runId, sourceDate: payload.authorityDate, status: 'applied', policy },
    ],
  };
  const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
  const ref = (path: string) => ({
    path,
    id: path.split('/').at(-1),
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (id: string) => ref(`${path}/${id}`),
  });
  const get = vi.fn(async ({ path }: { path: string }) => {
    const value = path.includes('/dailyRecords/')
      ? record
      : path.endsWith('/rayenImportPolicy')
        ? policy
        : ([...writes].reverse().find(write => write.path === path)?.value ?? null);
    return { exists: !!value, data: () => value };
  });
  const firestore = {
    collection: (name: string) => ref(name),
    runTransaction: vi.fn(async (callback: (txn: unknown) => Promise<unknown>) => {
      const pending: typeof writes = [];
      const result = await callback({
        get,
        create: (reference: { path: string }, value: Record<string, unknown>) =>
          pending.push({ path: reference.path, value }),
        update: (reference: { path: string }, value: Record<string, unknown>) =>
          pending.push({
            path: reference.path,
            value: {
              ...[...writes].reverse().find(write => write.path === reference.path)?.value,
              ...value,
            },
          }),
      });
      writes.push(...pending);
      return result;
    }),
  };
  const resolveRoleForEmail = vi.fn().mockResolvedValue('nurse_hospital');
  const hasCallableClinicalAccess = vi.fn().mockResolvedValue(true);
  const functions = createCudyrHistoryFunctions({
    firestore,
    resolveRoleForEmail,
    hasCallableClinicalAccess,
  });
  return {
    ...functions,
    record,
    policy,
    writes,
    firestore,
    resolveRoleForEmail,
    hasCallableClinicalAccess,
  };
};

describe('CUDYR archive callable boundaries', () => {
  it('rereads the full transaction after a concurrent create, but never assumes it succeeded', async () => {
    const h = harness();
    h.firestore.runTransaction.mockRejectedValueOnce(
      Object.assign(new Error('concurrent create'), { code: 6 })
    );
    expect(await h.archiveCudyrHistory.run(payload, context)).toMatchObject({ persisted: true });
    expect(h.firestore.runTransaction).toHaveBeenCalledTimes(2);
    expect(h.writes).toHaveLength(1);
  });

  const capture = {
    id: '00000000-0000-4000-8000-000000000001',
    clinicalEpisodeId: 'episode-test',
    sourceRunId: 'run-test',
    observedAt: '2026-10-06T20:00:00.000Z',
    status: 'observed',
    metadataStatus: 'partial',
    part: 0,
    totalParts: 1,
    totalEvaluations: 1,
  };

  it('commits source observations and their capture receipt together', async () => {
    const h = harness();
    const result = await h.archiveCudyrHistory.run({ ...payload, capture }, context);
    expect(result.captureReceiptId).toMatch(/^[a-f0-9]{64}$/);
    expect(h.writes).toHaveLength(3);
    const receipt = h.writes.find((write: { path: string; value: Record<string, unknown> }) =>
      write.path.includes('/cudyrCaptures/')
    )!.value;
    expect(receipt).toMatchObject({
      censusDate: payload.authorityDate,
      capture,
      observationIds: [result.results[0].id],
      captureContexts: [{ patientName: 'Paciente prueba' }],
    });
    await h.archiveCudyrHistory.run({ ...payload, capture }, context);
    expect(
      h.writes.filter((write: { path: string }) => write.path.includes('/cudyrCaptures/'))
    ).toHaveLength(1);
  });

  it('records an empty or failed source observation without inventing a CUDYR evaluation', async () => {
    const h = harness();
    await h.archiveCudyrHistory.run(
      {
        ...payload,
        evaluations: [],
        capture: {
          ...capture,
          status: 'unavailable',
          metadataStatus: 'unknown',
          totalEvaluations: 0,
        },
      },
      context
    );
    expect(h.writes).toHaveLength(2);
    expect(h.writes[0].path).toContain('/cudyrCaptures/');
    expect(h.writes[0].value).toMatchObject({
      observationIds: [],
      capture: { status: 'unavailable' },
    });
  });

  it('rejects conflicting content under the same source capture identity', async () => {
    const h = harness();
    await h.archiveCudyrHistory.run({ ...payload, capture }, context);
    await expect(
      h.archiveCudyrHistory.run(
        { ...payload, evaluations: [{ ...evaluation, category: 'D3' }], capture },
        context
      )
    ).rejects.toMatchObject({ code: 'already-exists' });
    expect(h.writes).toHaveLength(3);
  });

  it.each([
    { totalParts: 2 },
    { part: 1 },
    { totalEvaluations: 2 },
    { status: 'not_observed' },
    { clinicalEpisodeId: 'foreign' },
    { observedAt: '2026-02-30T20:00:00.000Z' },
  ])('rejects an inconsistent capture without storing a partial receipt: %j', async invalid => {
    const h = harness();
    await expect(
      h.archiveCudyrHistory.run({ ...payload, capture: { ...capture, ...invalid } }, context)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(h.writes).toHaveLength(0);
  });

  it('rejects contradictory sibling manifests and repeated observations across parts', async () => {
    const h = harness();
    const evaluations = Array.from({ length: 32 }, (_, index) => ({
      ...evaluation,
      sourceEvaluationId: `event-${index}`,
    }));
    await h.archiveCudyrHistory.run(
      { ...payload, evaluations, capture: { ...capture, totalEvaluations: 65, totalParts: 3 } },
      context
    );
    const before = h.writes.length;
    await expect(
      h.archiveCudyrHistory.run(
        { ...payload, capture: { ...capture, part: 1, totalEvaluations: 33, totalParts: 2 } },
        context
      )
    ).rejects.toMatchObject({ code: 'already-exists' });
    await expect(
      h.archiveCudyrHistory.run(
        {
          ...payload,
          evaluations,
          capture: { ...capture, part: 1, totalEvaluations: 65, totalParts: 3 },
        },
        context
      )
    ).rejects.toMatchObject({ code: 'already-exists' });
    expect(h.writes).toHaveLength(before);
    await h.archiveCudyrHistory.run(
      {
        ...payload,
        evaluations: evaluations.map(item => ({
          ...item,
          sourceEvaluationId: `${item.sourceEvaluationId}-next`,
        })),
        capture: { ...capture, part: 1, totalEvaluations: 65, totalParts: 3 },
      },
      context
    );
  });

  it('validates complete metadata server-side while allowing a genuinely empty observation', async () => {
    const h = harness();
    await expect(
      h.archiveCudyrHistory.run(
        { ...payload, capture: { ...capture, metadataStatus: 'complete' } },
        context
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(h.writes).toHaveLength(0);
    expect(
      await h.archiveCudyrHistory.run(
        {
          ...payload,
          evaluations: [],
          capture: { ...capture, metadataStatus: 'complete', totalEvaluations: 0 },
        },
        context
      )
    ).toMatchObject({ persisted: true });
  });

  it('binds capture to an authoritative run and episode without modifying the daily census', async () => {
    const h = harness();
    const before = structuredClone(h.record);
    const result = await h.archiveCudyrHistory.run(payload, context);
    expect(result).toMatchObject({ persisted: true, results: [{ status: 'recorded' }] });
    expect(h.record).toEqual(before);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].path).toMatch(/^hospitals\/hanga_roa\/cudyrHistory\/[a-f0-9]{64}$/);
    expect(h.writes[0].value).toMatchObject({
      censusDate: '2026-10-05',
      firstCapturedBy: 'test@example.com',
      evaluation: { author: 'Autor prueba' },
      captureContexts: [{ patientName: 'Paciente prueba', bedId: 'R1' }],
    });
  });

  it.each(['unauthorized', 'viewer'])(
    'rejects archive by %s before accessing clinical records',
    async role => {
      const h = harness();
      h.resolveRoleForEmail.mockResolvedValue(role);
      await expect(h.archiveCudyrHistory.run(payload, context)).rejects.toMatchObject({
        code: 'permission-denied',
      });
      expect(h.firestore.runTransaction).not.toHaveBeenCalled();
    }
  );

  it('rejects an unauthenticated caller', async () => {
    await expect(harness().archiveCudyrHistory.run(payload, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it.each(['run', 'policy', 'episode'])(
    'rejects mismatched %s without partial archive writes',
    async mismatch => {
      const h = harness();
      if (mismatch === 'run') h.record.rayenSyncHistory[0].status = 'failed';
      if (mismatch === 'policy') h.policy.clinicalBatchMode = 'shadow';
      const request =
        mismatch === 'episode'
          ? { ...payload, evaluations: [evaluation, { ...evaluation, clinicalEpisodeId: 'other' }] }
          : payload;
      await expect(h.archiveCudyrHistory.run(request, context)).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      expect(h.writes).toHaveLength(0);
    }
  );

  it('requires clinical read permission independently of authentication', async () => {
    const h = harness();
    h.hasCallableClinicalAccess.mockResolvedValue(false);
    await expect(
      h.readCudyrHistory.run({ from: '2026-10-01', to: '2026-10-31' }, context)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(h.readCudyrHistory.run({}, {})).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects oversized authoritative context atomically instead of creating an unpageable history', async () => {
    const h = harness();
    h.record.beds.R1.patientName = 'x'.repeat(41_000);
    await expect(h.archiveCudyrHistory.run(payload, context)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(h.writes).toHaveLength(0);
  });
});
