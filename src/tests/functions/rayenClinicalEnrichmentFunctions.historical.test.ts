import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  digestPayload,
  makeClinicalRecord,
  makeContext,
  makePayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const createApi = (admin: ReturnType<typeof createClinicalAdminMock>, role: string) =>
  createRayenClinicalEnrichmentFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });

const makeHistoricalCudyrPayload = () => ({
  ...makePayload(),
  date: '2026-07-27',
  authorityDate: '2026-07-28',
  expectedLastUpdated: '2026-07-27T10:00:00.000Z',
  patches: [
    {
      bedId: 'H2C1',
      clinicalEpisodeId: 'episode-secret-1',
      fields: {
        evaluationScores: {
          cudyr: {
            category: 'C1',
            recordedDate: '2026-07-27',
            source: 'gestion_camas',
          },
        },
      },
    },
  ],
});

const createHistoricalAdmin = () => {
  const target = makeClinicalRecord();
  target.date = '2026-07-27';
  target.lastUpdated = '2026-07-27T10:00:00.000Z';
  return createClinicalAdminMock(target, {
    authorityDate: '2026-07-28',
    authorityRemoteData: makeClinicalRecord(),
  });
};

describe('applyRayenClinicalEnrichmentBatch historical authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authorizes an admin CUDYR patch from the frozen source-day run', async () => {
    const admin = createHistoricalAdmin();

    await expect(
      createApi(admin, 'admin').applyRayenClinicalEnrichmentBatch.run(
        makeHistoricalCudyrPayload(),
        makeContext()
      )
    ).resolves.toMatchObject({ success: true, authorityStatus: 'ok', revision: 5 });

    expect(admin.policyGet).toHaveBeenCalledOnce();
    expect(admin.recordGet).toHaveBeenCalledTimes(2);
    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            evaluationScores: expect.objectContaining({
              cudyr: expect.objectContaining({ category: 'C1' }),
            }),
          }),
        }),
      })
    );
  });

  it('merges a narrow CUDYR correction without changing adjacent historical scores', async () => {
    const target = makeClinicalRecord();
    target.date = '2026-07-27';
    target.lastUpdated = '2026-07-27T10:00:00.000Z';
    (target.beds.H2C1 as { evaluationScores?: unknown }).evaluationScores = {
      braden: { total: 17 },
      downton: { total: 3 },
    };
    const admin = createClinicalAdminMock(target, {
      authorityDate: '2026-07-28',
      authorityRemoteData: makeClinicalRecord(),
    });

    await createApi(admin, 'admin').applyRayenClinicalEnrichmentBatch.run(
      makeHistoricalCudyrPayload(),
      makeContext()
    );

    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            evaluationScores: {
              braden: { total: 17 },
              downton: { total: 3 },
              cudyr: expect.objectContaining({ category: 'C1' }),
            },
          }),
        }),
      })
    );
  });

  it('requires an administrator for a previous-day CUDYR correction', async () => {
    const admin = createHistoricalAdmin();

    await expect(
      createApi(admin, 'nurse_hospital').applyRayenClinicalEnrichmentBatch.run(
        makeHistoricalCudyrPayload(),
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(admin.recordGet).toHaveBeenCalledTimes(2);
    expect(admin.policyGet).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects a request that omits the source-day authority binding', async () => {
    const admin = createHistoricalAdmin();
    const payload = { ...makeHistoricalCudyrPayload(), authorityDate: undefined };

    await expect(
      createApi(admin, 'admin').applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.recordGet).toHaveBeenCalledTimes(1);
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('accepts an exact historical retry before revalidating mutable patient state', async () => {
    const payload = makeHistoricalCudyrPayload();
    const target = makeClinicalRecord();
    target.date = payload.date;
    target.lastUpdated = payload.expectedLastUpdated;
    target.beds = {} as typeof target.beds;
    target.meta = {
      revision: 6,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          canonicalDigest: digestPayload(payload),
          fieldContractVersion: 2,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(target, {
      authorityDate: payload.authorityDate,
      authorityRemoteData: makeClinicalRecord(),
    });

    await expect(
      createApi(admin, 'admin').applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).resolves.toMatchObject({ authorityStatus: 'idempotent', revision: 6 });
    expect(admin.policyGet).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects non-CUDYR fields in a previous-day clinical batch', async () => {
    const admin = createHistoricalAdmin();
    const payload = {
      ...makeHistoricalCudyrPayload(),
      patches: [
        {
          bedId: 'H2C1',
          clinicalEpisodeId: 'episode-secret-1',
          fields: { vitalSigns: { systolic: 90 } },
        },
      ],
    };

    await expect(
      createApi(admin, 'admin').applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects changing another score inside a historical CUDYR value', async () => {
    const admin = createHistoricalAdmin();
    const payload = makeHistoricalCudyrPayload();
    payload.patches[0].fields.evaluationScores = {
      ...payload.patches[0].fields.evaluationScores,
      braden: { total: 8 },
    } as never;

    await expect(
      createApi(admin, 'admin').applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.set).not.toHaveBeenCalled();
  });
});
