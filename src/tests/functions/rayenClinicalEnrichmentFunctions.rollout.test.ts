import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  makeClinicalRecord,
  makeContext,
  makePayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const createApi = (admin: ReturnType<typeof createClinicalAdminMock>, role = 'nurse_hospital') =>
  createRayenClinicalEnrichmentFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });

describe('applyRayenClinicalEnrichmentBatch rollout authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a batch whose requested mode differs from the global policy', async () => {
    const admin = createClinicalAdminMock(undefined, { clinicalBatchMode: 'shadow' });

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.policyGet).toHaveBeenCalledTimes(1);
    expect(admin.recordGet).toHaveBeenCalledTimes(1);
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects a batch when its run did not freeze an authoritative policy', async () => {
    const admin = createClinicalAdminMock(undefined, { runPolicy: 'missing' });

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('accepts a current-day runtime-v1 batch backed by a matching structural run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T18:00:00.000Z'));
    try {
      const remote = makeClinicalRecord();
      Object.assign(remote, {
        rayenSyncHistory: [
          {
            id: 'structural-run-1',
            startedAt: '2026-07-28T17:59:00.000Z',
            status: 'applied',
            policy: { mode: 'preview', revision: 7 },
          },
        ],
      });
      const admin = createClinicalAdminMock(remote, {
        policySchemaVersion: 1,
        runPolicy: 'missing',
      });
      const { authorityDate: _authorityDate, ...runtimeV1Payload } = makePayload();
      runtimeV1Payload.runId = 'clinical-independent-run';

      await expect(
        createApi(admin).applyRayenClinicalEnrichmentBatch.run(runtimeV1Payload, makeContext())
      ).resolves.toMatchObject({ success: true, mode: 'enforced' });
      expect(admin.set).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a runtime-v1 batch outside the current Rapa Nui census day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T18:00:00.000Z'));
    try {
      const remote = makeClinicalRecord();
      Object.assign(remote, {
        rayenSyncHistory: [
          {
            id: 'structural-run-1',
            status: 'applied',
            policy: { mode: 'preview', revision: 7 },
          },
        ],
      });
      const admin = createClinicalAdminMock(remote, {
        policySchemaVersion: 1,
        runPolicy: 'missing',
      });
      const { authorityDate: _authorityDate, ...runtimeV1Payload } = makePayload();

      await expect(
        createApi(admin).applyRayenClinicalEnrichmentBatch.run(runtimeV1Payload, makeContext())
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(admin.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports the implicit preview policy during the same bounded v1 rollout window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T18:00:00.000Z'));
    try {
      const remote = makeClinicalRecord();
      Object.assign(remote, {
        rayenSyncHistory: [
          {
            id: 'structural-run-1',
            status: 'applied',
            policy: { mode: 'preview', revision: 0 },
          },
        ],
      });
      const admin = createClinicalAdminMock(remote, {
        policyExists: false,
        policyRevision: 0,
        policySchemaVersion: 1,
        runPolicy: 'missing',
      });
      const { authorityDate: _authorityDate, ...runtimeV1Payload } = makePayload();

      await expect(
        createApi(admin).applyRayenClinicalEnrichmentBatch.run(runtimeV1Payload, makeContext())
      ).resolves.toMatchObject({ success: true, mode: 'enforced' });
      expect(admin.set).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a runtime-v1 batch without a matching applied structural run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T18:00:00.000Z'));
    try {
      const admin = createClinicalAdminMock(undefined, {
        policySchemaVersion: 1,
        runPolicy: 'missing',
      });
      const { authorityDate: _authorityDate, ...runtimeV1Payload } = makePayload();

      await expect(
        createApi(admin).applyRayenClinicalEnrichmentBatch.run(runtimeV1Payload, makeContext())
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(admin.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes runtime-v1 write authority after the global policy migrates to v2', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T18:00:00.000Z'));
    try {
      const remote = makeClinicalRecord();
      Object.assign(remote, {
        rayenSyncHistory: [
          {
            id: 'structural-run-1',
            status: 'applied',
            policy: { mode: 'preview', revision: 7 },
          },
        ],
      });
      const admin = createClinicalAdminMock(remote, { runPolicy: 'missing' });
      const { authorityDate: _authorityDate, ...runtimeV1Payload } = makePayload();

      await expect(
        createApi(admin).applyRayenClinicalEnrichmentBatch.run(runtimeV1Payload, makeContext())
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(admin.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['complete', 'partial', 'failed'] as const)(
    'rejects a new mutation after its synchronization run becomes %s',
    async runStatus => {
      const admin = createClinicalAdminMock(undefined, { runStatus });

      await expect(
        createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(admin.set).not.toHaveBeenCalled();
    }
  );

  it('rejects a batch after the global policy revision changes', async () => {
    const remote = makeClinicalRecord();
    Object.assign(remote, {
      rayenSyncHistory: [
        {
          id: 'run-1',
          sourceDate: '2026-07-28',
          startedAt: '2026-07-28T09:59:00.000Z',
          by: 'nurse@example.com',
          status: 'applied',
          policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 6 },
        },
      ],
    });
    const admin = createClinicalAdminMock(remote, {
      policyRevision: 7,
      runPolicy: 'missing',
    });

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects authenticated viewers before reading or writing clinical data', async () => {
    const admin = createClinicalAdminMock();

    await expect(
      createApi(admin, 'viewer').applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failure', errorCode: 'permission-denied' })
    );
  });

  it('rejects unauthenticated callers without emitting telemetry', async () => {
    const admin = createClinicalAdminMock();

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), {})
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.telemetryAdd).not.toHaveBeenCalled();
  });
});
