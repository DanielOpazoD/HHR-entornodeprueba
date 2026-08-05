import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  makeClinicalRecord,
  makeContext,
  makePayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const createApi = (admin: ReturnType<typeof createClinicalAdminMock>) =>
  createRayenClinicalEnrichmentFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
  });

describe('applyRayenClinicalEnrichmentBatch chunking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a distinct mutation as another bounded chunk of the same run', async () => {
    const remote = makeClinicalRecord();
    remote.meta = {
      revision: 5,
      clinicalEnrichmentReceipts: [
        {
          runId: 'run-1',
          mutationId: 'mutation-original',
          digest: 'digest-from-another-payload',
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote, { historySnapshotExists: true });
    const payload = {
      ...makePayload(),
      baseRevision: 5,
      mutationId: 'mutation-next-chunk',
    };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).resolves.toMatchObject({ authorityStatus: 'ok', historySnapshots: 0 });
    expect(admin.historyDoc).toHaveBeenCalledOnce();
    expect(admin.create).not.toHaveBeenCalled();
    expect(admin.set).toHaveBeenCalledOnce();
    expect(admin.set.mock.calls[0]?.[1]?.meta?.clinicalEnrichmentReceipts).toEqual([
      expect.objectContaining({ mutationId: 'mutation-original' }),
      expect.objectContaining({ mutationId: 'mutation-next-chunk', clinicalTargetCount: 1 }),
    ]);
  });

  it('persists sequential chunks with one run snapshot and a receipt per mutation', async () => {
    const remote = makeClinicalRecord();
    (remote.beds as Record<string, unknown>).H2C2 = {
      bedId: 'H2C2',
      patientName: 'Segundo paciente',
      clinicalEpisodeId: 'episode-secret-2',
    };
    const admin = createClinicalAdminMock(remote);
    const api = createApi(admin);

    const firstResult = await api.applyRayenClinicalEnrichmentBatch.run(
      makePayload(),
      makeContext()
    );
    const afterFirst = {
      ...admin.set.mock.calls[0]?.[1],
      lastUpdated: '2026-07-28T10:01:00.000Z',
    };
    admin.recordsByDate.set('2026-07-28', afterFirst);
    const secondPayload = {
      ...makePayload(),
      mutationId: 'mutation-2',
      expectedLastUpdated: '2026-07-28T10:01:00.000Z',
      baseRevision: 5,
      patches: [
        {
          bedId: 'H2C2',
          clinicalEpisodeId: 'episode-secret-2',
          fields: { vitalSigns: { systolic: 118 } },
        },
      ],
    };

    const secondResult = await api.applyRayenClinicalEnrichmentBatch.run(
      secondPayload,
      makeContext()
    );

    expect(firstResult).toMatchObject({ authorityStatus: 'ok', historySnapshots: 1 });
    expect(secondResult).toMatchObject({ authorityStatus: 'ok', historySnapshots: 0 });
    expect(admin.create).toHaveBeenCalledOnce();
    expect(admin.set).toHaveBeenCalledTimes(2);
    expect(admin.set.mock.calls[1]?.[1]?.meta?.clinicalEnrichmentReceipts).toEqual([
      expect.objectContaining({ mutationId: 'mutation-1', clinicalTargetCount: 1 }),
      expect.objectContaining({ mutationId: 'mutation-2', clinicalTargetCount: 1 }),
    ]);
  });

  it('does not recreate a run snapshot after its clinical receipt rotates out', async () => {
    const remote = makeClinicalRecord();
    remote.lastUpdated = '2026-07-28T10:20:00.000Z';
    remote.meta = {
      revision: 20,
      clinicalEnrichmentReceipts: Array.from({ length: 16 }, (_, index) => ({
        runId: 'run-1',
        mutationId: `checkpoint-${index + 1}`,
        digest: `checkpoint-digest-${index + 1}`,
        clinicalTargetCount: 0,
        checkpointTargetCount: 1,
      })),
    } as never;
    const admin = createClinicalAdminMock(remote, { historySnapshotExists: true });
    const payload = {
      ...makePayload(),
      mutationId: 'mutation-after-receipt-rotation',
      expectedLastUpdated: remote.lastUpdated,
      baseRevision: 20,
    };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).resolves.toMatchObject({ authorityStatus: 'ok', historySnapshots: 0 });
    expect(admin.create).not.toHaveBeenCalled();
    expect(admin.set).toHaveBeenCalledOnce();
  });
});
