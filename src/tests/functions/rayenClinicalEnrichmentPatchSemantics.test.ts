import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clinicalEnrichmentMatches,
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  makeClinicalRecord,
  makeContext,
  makePayload,
  parseClinicalEnrichmentPayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const createApi = (admin: ReturnType<typeof createClinicalAdminMock>) =>
  createRayenClinicalEnrichmentFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
  });

describe('Rayen clinical enrichment patch semantics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires exact canonical values for complete clinical fields', () => {
    const record = makeClinicalRecord();
    const payload = parseClinicalEnrichmentPayload(makePayload());
    const matching = {
      ...record,
      beds: {
        ...record.beds,
        H2C1: {
          ...record.beds.H2C1,
          evaluationScores: {
            braden: { total: 17, recordedAt: 'preserved' },
            downton: { total: 3 },
          },
          vitalSigns: { systolic: 120, heartRate: 76 },
          clinicalSyncCheckpoint: { version: 1, sources: {}, legacyMarker: true },
        },
      },
    };

    expect(clinicalEnrichmentMatches(matching, payload.targets, payload.fieldContractVersion)).toBe(
      false
    );
    const exact = {
      ...matching,
      beds: {
        ...matching.beds,
        H2C1: {
          ...matching.beds.H2C1,
          evaluationScores: { braden: { total: 17 } },
          vitalSigns: { systolic: 120 },
          clinicalSyncCheckpoint: { version: 1, sources: {} },
        },
      },
    };
    expect(clinicalEnrichmentMatches(exact, payload.targets, payload.fieldContractVersion)).toBe(
      true
    );
    expect(
      clinicalEnrichmentMatches(
        {
          ...exact,
          beds: {
            ...exact.beds,
            H2C1: { ...exact.beds.H2C1, vitalSigns: { systolic: 119 } },
          },
        },
        payload.targets,
        payload.fieldContractVersion
      )
    ).toBe(false);
  });

  it('replaces canonical clinical objects so removed leaves do not survive', async () => {
    const remote = makeClinicalRecord();
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: {
        braden: { total: 12, recordedAt: 'preserved' },
        downton: { total: 3 },
      },
      clinicalSyncCheckpoint: {
        version: 0,
        sources: { vitals: { watermark: 'old' } },
        legacyMarker: true,
      },
    } as never;
    const admin = createClinicalAdminMock(remote);

    await createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext());

    expect(admin.set).toHaveBeenCalledWith(
      admin.docRef,
      expect.objectContaining({
        beds: expect.objectContaining({
          H2C1: expect.objectContaining({
            evaluationScores: {
              braden: { total: 17 },
            },
            clinicalSyncCheckpoint: {
              version: 1,
              sources: {},
            },
          }),
        }),
      })
    );
  });

  it('keeps exact replacement semantics for clinical arrays', async () => {
    const remote = makeClinicalRecord();
    remote.beds.H2C1 = { ...remote.beds.H2C1, devices: ['CVC', 'VVP'] } as never;
    const payload = makePayload();
    payload.patches[0].fields = { devices: ['VVP'] } as never;
    const admin = createClinicalAdminMock(remote);

    await createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext());

    expect(admin.set.mock.calls[0]?.[1]?.beds?.H2C1?.devices).toEqual(['VVP']);
    const parsed = parseClinicalEnrichmentPayload(payload);
    expect(clinicalEnrichmentMatches(remote, parsed.targets, parsed.fieldContractVersion)).toBe(
      false
    );
  });

  it('preserves nested siblings for unversioned rolling-deployment clients', async () => {
    const remote = makeClinicalRecord();
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { downton: { total: 3 } },
      vitalSigns: { heartRate: 76 },
    } as never;
    const { fieldContractVersion: _removed, ...payload } = makePayload();
    const admin = createClinicalAdminMock(remote);

    await createApi(admin).applyRayenClinicalEnrichmentBatch.run(payload, makeContext());

    expect(admin.set.mock.calls[0]?.[1]?.beds?.H2C1).toMatchObject({
      evaluationScores: { braden: { total: 17 }, downton: { total: 3 } },
      vitalSigns: { systolic: 120, heartRate: 76 },
    });
  });
});
