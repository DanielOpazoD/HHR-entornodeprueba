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
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (id: string) => ref(`${path}/${id}`),
  });
  const get = vi.fn(async ({ path }: { path: string }) => {
    const value = path.includes('/dailyRecords/')
      ? record
      : path.endsWith('/rayenImportPolicy')
        ? policy
        : null;
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
