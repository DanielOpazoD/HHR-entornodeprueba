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

  it('applies all allowlisted patient fields with one census read and one run snapshot', async () => {
    const admin = createClinicalAdminMock();
    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      makePayload(),
      makeContext()
    );

    expect(admin.policyGet).toHaveBeenCalledTimes(1);
    expect(admin.recordGet).toHaveBeenCalledTimes(1);
    expect(admin.historyDoc).toHaveBeenCalledTimes(1);
    expect(admin.historyDoc).toHaveBeenCalledWith(expect.stringMatching(/^rayen-clinical-/));
    expect(admin.create).toHaveBeenCalledTimes(1);
    expect(admin.set).toHaveBeenCalledTimes(1);
    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            evaluationScores: { braden: { total: 17 } },
            vitalSigns: { systolic: 120 },
          }),
        }),
        meta: expect.objectContaining({
          revision: 5,
          lastMutationId: 'mutation-1',
          clinicalEnrichmentReceipts: [
            expect.objectContaining({
              runId: 'run-1',
              mutationId: 'mutation-1',
              fieldContractVersion: 2,
              canonicalDigest: digestPayload(makePayload()),
            }),
          ],
        }),
      })
    );
    expect(result).toMatchObject({
      success: true,
      authorityStatus: 'ok',
      revision: 5,
      targetCount: 1,
      fieldCount: 3,
    });
    expect(admin.set.mock.calls[0]?.[1]?.meta?.clinicalEnrichmentReceipts?.[0]?.digest).toBe(
      buildLegacyClinicalEnrichmentDigest(parseClinicalEnrichmentPayload(makePayload()))
    );
    const telemetry = JSON.stringify(admin.telemetryAdd.mock.calls[0]?.[0]);
    expect(telemetry).not.toMatch(/H2C1|episode-secret|Paciente reservado|11\.111|braden|120/);
  });
  it('recognizes an exact committed retry even after the global policy changes', async () => {
    const payload = makePayload();
    const remote = makeClinicalRecord();
    remote.meta = {
      revision: 5,
      clinicalEnrichmentReceipts: [
        {
          runId: payload.runId,
          mutationId: payload.mutationId,
          fieldContractVersion: payload.fieldContractVersion,
          canonicalDigest: digestPayload(payload),
        },
      ],
    } as never;
    Object.assign(remote, {
      rayenSyncHistory: [
        {
          id: payload.runId,
          sourceDate: payload.authorityDate,
          policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 7 },
        },
      ],
    });
    const admin = createClinicalAdminMock(remote, { policyRevision: 8, runPolicy: 'missing' });

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).resolves.toMatchObject({
      success: true,
      authorityStatus: 'idempotent',
      revision: 5,
      patientWrites: 0,
      historySnapshots: 0,
    });
    expect(admin.policyGet).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects stale record revisions without partial writes', async () => {
    const admin = createClinicalAdminMock();
    const payload = { ...makePayload(), baseRevision: 3 };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({
      code: 'aborted',
      message: expect.stringContaining('revision_mismatch'),
    });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects a target whose clinical episode no longer matches the bed', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    payload.patches[0].clinicalEpisodeId = 'another-episode';

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('updates a clinical crib only when its own episode matches', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    payload.patches = [
      {
        bedId: 'H2C1',
        clinicalEpisodeId: 'episode-crib-secret',
        clinicalCrib: true,
        fields: { vitalSigns: { heartRate: 132 } },
      },
    ] as never;

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ targetCount: 1, fieldCount: 1 });
    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            clinicalCrib: expect.objectContaining({ vitalSigns: { heartRate: 132 } }),
          }),
        }),
      })
    );
  });

  it('rejects non-allowlisted fields before reading the census', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    payload.patches[0].fields = { patientName: 'Nombre alterado' } as never;

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
    expect(admin.telemetryAdd).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(admin.telemetryAdd.mock.calls[0]?.[0])).not.toContain('Nombre alterado');
  });

  it('rejects duplicate checkpoint targets embedded in legacy patches', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    payload.patches = [
      {
        ...payload.patches[0],
        fields: { clinicalSyncCheckpoint: { version: 1, sources: {} } },
      },
      {
        ...payload.patches[0],
        fields: { clinicalSyncCheckpoint: { version: 2, sources: {} } },
      },
    ] as never;

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects clinical and checkpoint sections that reference different episodes', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    Object.assign(payload, {
      checkpoints: [
        {
          bedId: 'H2C1',
          clinicalEpisodeId: 'another-episode',
          checkpoint: { version: 1, fingerprintVersion: 1, sources: {} },
        },
      ],
    });

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('requires an expected record timestamp before reading the census', async () => {
    const admin = createClinicalAdminMock();
    const payload = { ...makePayload(), expectedLastUpdated: undefined };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects historical targets outside the immediately preceding census day', async () => {
    const admin = createClinicalAdminMock();
    const payload = {
      ...makePayload(),
      date: '2026-07-26',
      authorityDate: '2026-07-28',
    };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it.each([
    ['date', '2026-02-30'],
    ['authorityDate', '2026-99-99'],
  ])('rejects an invalid calendar %s before reading the census', async (field, value) => {
    const admin = createClinicalAdminMock();
    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(
        { ...makePayload(), [field]: value },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
  });

  it('rejects a batch larger than the safe Firestore request budget', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    payload.patches[0].fields = {
      deviceDetails: { oversized: 'x'.repeat(510_000) },
    } as never;

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('returns a compatible idempotent shadow response when canonical data already matches', async () => {
    const remote = makeClinicalRecord();
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 } },
      vitalSigns: { systolic: 120 },
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    const admin = createClinicalAdminMock(remote, { clinicalBatchMode: 'shadow' });
    const payload = {
      ...makePayload(),
      mode: 'shadow',
      dryRun: false,
      baseRevision: 1,
      expectedLastUpdated: '2026-07-27T10:00:00.000Z',
    };
    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({
      success: true,
      mode: 'shadow',
      authorityStatus: 'idempotent',
      resultParity: 'matched',
      patientWrites: 0,
      historySnapshots: 0,
    });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('rejects a new enforced no-op whose base revision is stale', async () => {
    const remote = makeClinicalRecord();
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 } },
      vitalSigns: { systolic: 120 },
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    const admin = createClinicalAdminMock(remote);
    const payload = {
      ...makePayload(),
      baseRevision: 3,
      expectedLastUpdated: '2026-07-27T10:00:00.000Z',
    };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({
      code: 'aborted',
      message: expect.stringContaining('revision_mismatch'),
    });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('reports a shadow mismatch when established persistence differs from the batch', async () => {
    const admin = createClinicalAdminMock(undefined, { clinicalBatchMode: 'shadow' });
    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      { ...makePayload(), mode: 'shadow' },
      makeContext()
    );

    expect(result).toMatchObject({
      success: true,
      mode: 'shadow',
      resultParity: 'mismatch',
      patientWrites: 0,
      historySnapshots: 0,
    });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('persists a checkpoint-only batch without creating a clinical history snapshot', async () => {
    const admin = createClinicalAdminMock();
    const payload = makePayload();
    payload.patches = [];
    Object.assign(payload, {
      checkpoints: [
        {
          bedId: 'H2C1',
          clinicalEpisodeId: 'episode-secret-1',
          checkpoint: { version: 1, fingerprintVersion: 1, sources: {} },
        },
      ],
    });

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(admin.policyGet).toHaveBeenCalledTimes(1);
    expect(admin.recordGet).toHaveBeenCalledTimes(1);
    expect(admin.historyDoc).not.toHaveBeenCalled();
    expect(admin.create).not.toHaveBeenCalled();
    expect(admin.set).toHaveBeenCalledTimes(1);
    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            clinicalSyncCheckpoint: expect.objectContaining({ version: 1 }),
          }),
        }),
      })
    );
    expect(result).toMatchObject({
      targetCount: 1,
      clinicalTargetCount: 0,
      checkpointOnlyTargetCount: 1,
      patientWrites: 1,
      historySnapshots: 0,
    });
  });

  it('ignores a caller dry-run override when enforced mode is requested', async () => {
    const admin = createClinicalAdminMock();
    const payload = { ...makePayload(), mode: 'enforced', dryRun: true };

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ success: true, mode: 'enforced' });
    expect(admin.create).toHaveBeenCalledTimes(1);
    expect(admin.set).toHaveBeenCalledTimes(1);
  });
});
