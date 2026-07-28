import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

    expect(admin.get).toHaveBeenCalledTimes(1);
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
            expect.objectContaining({ runId: 'run-1', mutationId: 'mutation-1' }),
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
    const telemetry = JSON.stringify(admin.telemetryAdd.mock.calls[0]?.[0]);
    expect(telemetry).not.toMatch(/H2C1|episode-secret|Paciente reservado|11\.111|braden|120/);
  });

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
          digest: digestPayload(payload),
        },
      ],
    } as never;
    const admin = createClinicalAdminMock(remote);
    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      payload,
      makeContext()
    );

    expect(result).toMatchObject({ authorityStatus: 'idempotent' });
    expect(admin.set).not.toHaveBeenCalled();
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
          digest: digestPayload(payload),
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

  it('rejects reuse of a run id with a different clinical payload', async () => {
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
    const admin = createClinicalAdminMock(remote);

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.historyDoc).not.toHaveBeenCalled();
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

  it('requires an expected record timestamp before reading the census', async () => {
    const admin = createClinicalAdminMock();
    const payload = { ...makePayload(), expectedLastUpdated: undefined };

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(admin.get).not.toHaveBeenCalled();
    expect(admin.set).not.toHaveBeenCalled();
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

  it('forces shadow requests to dry-run without creating a snapshot', async () => {
    const admin = createClinicalAdminMock();
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

    expect(result).toMatchObject({ success: true, mode: 'shadow', authorityStatus: 'ok' });
    expect(admin.set).not.toHaveBeenCalled();
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
