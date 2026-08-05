import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLegacyClinicalEnrichmentDigest,
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  digestPayload,
  makeClinicalRecord,
  makeContext,
  makePayload,
  parseClinicalEnrichmentPayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const createApi = (admin: ReturnType<typeof createClinicalAdminMock>, role = 'nurse_hospital') =>
  createRayenClinicalEnrichmentFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });

describe('applyRayenClinicalEnrichmentBatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns idempotent success before revision checks for the same run and mutation', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    remote.lastUpdated = '2026-07-28T11:00:00.000Z';
    remote.meta = {
      revision: 8,
      clinicalEnrichmentReceipts: [
        {
          runId: 'run-1',
          mutationId: 'mutation-1',
          digest: buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(payload)),
          canonicalDigest: digestPayload(payload),
          fieldContractVersion: 2,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote, { runStatus: 'complete' });
    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ authorityStatus: 'idempotent' });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('skips persistence when a new run requests clinical values already stored exactly', async () => {
    const remote = makeClinicalRecord();
    remote.lastUpdated = '2026-07-28T11:00:00.000Z';
    remote.meta = { revision: 8 } as never;
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 } },
      vitalSigns: { systolic: 120 },
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    const admin = createClinicalAdminMock(remote);
    const payload = {
      ...makePayload(),
      baseRevision: 8,
      expectedLastUpdated: remote.lastUpdated,
    };

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({
      authorityStatus: 'idempotent',
      resultParity: 'matched',
      revision: 8,
      patientWrites: 0,
      historySnapshots: 0,
    });
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('converges stale v1 nested leaves instead of trusting a legacy receipt for v2', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    const parsed = parseClinicalEnrichmentPayload(payload);
    remote.lastUpdated = '2026-07-28T10:05:00.000Z';
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 }, staleScore: { total: 99 } },
      vitalSigns: { systolic: 120, stalePulse: 999 },
      clinicalSyncCheckpoint: { version: 1, sources: {}, staleSource: true },
    } as never;
    remote.meta = {
      revision: 5,
      lastMutationId: payload.mutationId,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          digest: buildLegacyClinicalEnrichmentDigest(parsed),
          appliedAt: remote.lastUpdated,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({
      authorityStatus: 'ok',
      patientWrites: 1,
      historySnapshots: 0,
    });
    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            evaluationScores: { braden: { total: 17 } },
            vitalSigns: { systolic: 120 },
            clinicalSyncCheckpoint: { version: 1, sources: {} },
          }),
        }),
        meta: expect.objectContaining({
          clinicalEnrichmentReceipts: [
            expect.objectContaining({
              fieldContractVersion: 2,
              canonicalDigest: digestPayload(payload),
            }),
          ],
        }),
      })
    );
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('keeps recognizing an unversioned canonical receipt during rollout', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 } },
      vitalSigns: { systolic: 120 },
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    remote.meta = {
      revision: 5,
      lastMutationId: payload.mutationId,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          digest: digestPayload(payload),
          appliedAt: remote.lastUpdated,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ authorityStatus: 'idempotent', patientWrites: 0 });
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('repairs a legacy receipt matched by run id after the mutation id changes', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    const legacyMutationId = 'mutation-from-v1-instance';
    remote.lastUpdated = '2026-07-28T10:05:00.000Z';
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 }, staleScore: { total: 99 } },
      vitalSigns: { systolic: 120, stalePulse: 999 },
      clinicalSyncCheckpoint: { version: 1, sources: {}, staleSource: true },
    } as never;
    remote.meta = {
      revision: 5,
      lastMutationId: legacyMutationId,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: legacyMutationId,
          digest: buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(payload)),
          appliedAt: remote.lastUpdated,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({
      authorityStatus: 'ok',
      patientWrites: 1,
      historySnapshots: 0,
    });
    expect(admin.set).toHaveBeenCalledTimes(1);
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('does not repair a legacy replay after another mutation changed the record', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    remote.lastUpdated = '2026-07-28T10:10:00.000Z';
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 }, staleScore: { total: 99 } },
      vitalSigns: { systolic: 120, stalePulse: 999 },
      clinicalSyncCheckpoint: { version: 1, sources: {}, staleSource: true },
    } as never;
    remote.meta = {
      revision: 6,
      lastMutationId: 'later-mutation',
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          digest: buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(payload)),
          appliedAt: '2026-07-28T10:05:00.000Z',
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({
      code: 'aborted',
      message: expect.stringContaining('revision_mismatch'),
    });
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('keeps accepting a pre-deployment digest for a v1 rolling retry', async () => {
    const remote = makeClinicalRecord();
    const payload = { ...makePayload(), fieldContractVersion: undefined };
    payload.patches[0].fields = {
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    const parsed = parseClinicalEnrichmentPayload(payload);
    remote.meta = {
      revision: 5,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          digest: buildLegacyClinicalEnrichmentDigest(parsed),
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ authorityStatus: 'idempotent', patientWrites: 0 });
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('does not downgrade a v2 receipt to the legacy digest fallback', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    remote.meta = {
      revision: 5,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          digest: buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(payload)),
          canonicalDigest: 'canonical-digest-from-another-payload',
          fieldContractVersion: 2,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('reports history writes from the transaction attempt that actually commits', async () => {
    const payload = makePayload();
    const committed = makeClinicalRecord();
    committed.beds.H2C1 = {
      ...committed.beds.H2C1,
      evaluationScores: { braden: { total: 17 } },
      vitalSigns: { systolic: 120 },
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    committed.meta = {
      revision: 5,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          digest: buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(payload)),
          canonicalDigest: digestPayload(payload),
          fieldContractVersion: 2,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock();
    const committedWithAuthority = {
      ...committed,
      rayenSyncHistory: [admin.runEvent],
    };
    admin.recordGet
      .mockResolvedValueOnce({ exists: true, data: () => admin.authorizedRemoteData })
      .mockResolvedValueOnce({ exists: true, data: () => committedWithAuthority });
    admin.runTransaction.mockImplementation(async callback => {
      await callback(admin.transaction);
      return callback(admin.transaction);
    });

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({
      authorityStatus: 'idempotent',
      patientWrites: 0,
      historySnapshots: 0,
    });
    // The retried transaction first observes the exact committed receipt and returns before
    // consulting mutable policy, so only the transaction attempt that wrote reads authority.
    expect(admin.policyGet).toHaveBeenCalledTimes(1);
    expect(admin.recordGet).toHaveBeenCalledTimes(2);
  });

  it('orders digest targets with deterministic UTF-16 code units', () => {
    const payload = makePayload();
    payload.patches = [
      { ...payload.patches[0], bedId: 'á' },
      { ...payload.patches[0], bedId: 'Z' },
    ];

    expect(parseClinicalEnrichmentPayload(payload).patches).toMatchObject([
      { bedId: 'Z' },
      { bedId: 'á' },
    ]);
  });

  it('keeps one snapshot when the same run is retried with a new mutation id', async () => {
    const remote = makeClinicalRecord();
    const payload = makePayload();
    remote.meta = {
      revision: 5,
      clinicalEnrichmentReceipts: [
        {
          runId: 'run-1',
          mutationId: 'mutation-original',
          digest: buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(payload)),
          canonicalDigest: digestPayload(payload),
          fieldContractVersion: 2,
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ authorityStatus: 'idempotent', revision: 5 });
    expect(admin.historyDoc).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });
});
