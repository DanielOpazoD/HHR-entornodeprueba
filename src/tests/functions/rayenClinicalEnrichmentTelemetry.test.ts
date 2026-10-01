import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  makeClinicalRecord,
  makeContext,
  makePayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const createApi = (
  admin: ReturnType<typeof createClinicalAdminMock>,
  overrides: { monotonicNow?: () => number; resolveRoleForEmail?: () => Promise<string> } = {}
) =>
  createRayenClinicalEnrichmentFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    ...overrides,
  });

describe('Rayen clinical enrichment telemetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([false, true])(
    'measures awaited telemetry separately (transaction failure: %s)',
    async fails => {
      const admin = createClinicalAdminMock();
      let clock = 100;
      const originalTransaction = admin.runTransaction.getMockImplementation()!;
      admin.runTransaction.mockImplementation(async callback => {
        const result = await originalTransaction(callback);
        clock += 31;
        if (fails) throw new Error('transaction failed');
        return result;
      });
      admin.telemetryAdd.mockImplementation(async () => {
        clock += 59;
        return { id: 'telemetry-1' };
      });
      const api = createApi(admin, {
        monotonicNow: () => clock,
        resolveRoleForEmail: async () => {
          clock += 7;
          return 'nurse_hospital';
        },
      });
      const expected = { authorizationMs: 7, transactionMs: 31, telemetryMs: 59, handlerMs: 97 };
      const call = api.applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext());
      if (fails) {
        await expect(call).rejects.toMatchObject({ details: { serverTimingsMs: expected } });
      } else {
        await expect(call).resolves.toMatchObject({ serverTimingsMs: expected });
      }
      const telemetry = admin.telemetryAdd.mock.calls[0]?.[0];
      expect(telemetry.context.serverTimingsMs).toEqual({ authorizationMs: 7, transactionMs: 31 });
      expect(telemetry.context.serverTimingsMs).not.toHaveProperty('telemetryMs');
    }
  );

  it('does not attribute preparation failures to the completed authorization phase', async () => {
    const admin = createClinicalAdminMock();
    let clock = 0;
    admin.firestore().collection.mockImplementationOnce(() => {
      clock += 13;
      throw new Error('synthetic reference preparation failure');
    });
    const api = createApi(admin, {
      monotonicNow: () => clock,
      resolveRoleForEmail: async () => {
        clock += 7;
        return 'nurse_hospital';
      },
    });
    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({
      details: { serverTimingsMs: { authorizationMs: 7, telemetryMs: 0, handlerMs: 20 } },
    });
    expect(admin.runTransaction).not.toHaveBeenCalled();
    expect(admin.telemetryAdd.mock.calls[0]?.[0].context.serverTimingsMs).toEqual({
      authorizationMs: 7,
    });
  });

  it('reports only measured phases when authorization fails', async () => {
    const admin = createClinicalAdminMock();
    let clock = 0;
    const api = createApi(admin, {
      monotonicNow: () => clock,
      resolveRoleForEmail: async () => {
        clock += 5;
        return 'viewer';
      },
    });
    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({
      details: { serverTimingsMs: { authorizationMs: 5, telemetryMs: 0, handlerMs: 5 } },
    });
    expect(admin.runTransaction).not.toHaveBeenCalled();
    expect(admin.telemetryAdd.mock.calls[0]?.[0].context.serverTimingsMs).not.toHaveProperty(
      'transactionMs'
    );
  });

  it('records matched shadow parity without clinical identifiers', async () => {
    const remote = makeClinicalRecord();
    remote.beds.H2C1 = {
      ...remote.beds.H2C1,
      evaluationScores: { braden: { total: 17 } },
      vitalSigns: { systolic: 120 },
      clinicalSyncCheckpoint: { version: 1, sources: {} },
    } as never;
    const admin = createClinicalAdminMock(remote, { clinicalBatchMode: 'shadow' });

    await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      { ...makePayload(), mode: 'shadow' },
      makeContext()
    );

    expect(admin.telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resultParity: 'matched',
          parityContractVersion: 2,
          mismatchTargetCount: 0,
          mismatchFieldCount: 0,
          targetScope: 'current',
          runCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
          mutationCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
          transactionAttempts: 1,
          transactionRetries: 0,
        }),
      })
    );
    const telemetry = admin.telemetryAdd.mock.calls[0]?.[0];
    expect(JSON.stringify(telemetry)).not.toMatch(
      /H2C1|episode-secret|Paciente reservado|11\.111|braden|run-1|mutation-1/
    );
    expect(JSON.stringify(telemetry?.context)).not.toMatch(/120/);
  });

  it('reports internal Firestore transaction retries truthfully', async () => {
    const admin = createClinicalAdminMock();
    admin.runTransaction.mockImplementation(async callback => {
      await callback(admin.transaction);
      return callback(admin.transaction);
    });

    const result = await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      makePayload(),
      makeContext()
    );

    expect(result).toMatchObject({ transactionAttempts: 2, transactionRetries: 1 });
    expect(admin.telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 2,
        totalAttempts: 2,
        context: expect.objectContaining({
          transactionAttempts: 2,
          transactionRetries: 1,
        }),
      })
    );
  });

  it('returns sanitized transaction retry details when the callable fails', async () => {
    const admin = createClinicalAdminMock();
    admin.runTransaction.mockImplementation(async callback => {
      await callback(admin.transaction);
      await callback(admin.transaction);
      throw new Error('transaction failed');
    });

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({
      code: 'internal',
      details: {
        targetScope: 'current',
        transactionAttempts: 2,
        transactionRetries: 1,
      },
    });
    expect(JSON.stringify(admin.telemetryAdd.mock.calls[0]?.[0])).not.toMatch(
      /H2C1|episode-secret|Paciente reservado|11\.111|run-1|mutation-1/
    );
  });

  it('records a mismatch when established persistence differs from the batch', async () => {
    const admin = createClinicalAdminMock(undefined, { clinicalBatchMode: 'shadow' });

    await createApi(admin).applyRayenClinicalEnrichmentBatch.run(
      { ...makePayload(), mode: 'shadow' },
      makeContext()
    );

    expect(admin.telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resultParity: 'mismatch',
          parityContractVersion: 2,
          mismatchTargetCount: 1,
          mismatchFieldCount: 3,
          mismatchDeviceFieldCount: 0,
          mismatchScoreFieldCount: 1,
          mismatchVitalFieldCount: 1,
          mismatchCheckpointFieldCount: 1,
        }),
      })
    );
    const telemetry = admin.telemetryAdd.mock.calls[0]?.[0];
    expect(JSON.stringify(telemetry)).not.toMatch(
      /H2C1|episode-secret|Paciente reservado|11\.111|evaluationScores|vitalSigns|braden/
    );
    expect(JSON.stringify(telemetry?.context)).not.toMatch(/120/);
  });

  it('records unavailable parity when validation fails before comparison', async () => {
    const admin = createClinicalAdminMock();

    await expect(
      createApi(admin).applyRayenClinicalEnrichmentBatch.run(
        { ...makePayload(), date: undefined },
        makeContext()
      )
    ).rejects.toThrow();

    expect(admin.telemetryAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 0,
        totalAttempts: 0,
        context: expect.objectContaining({
          resultParity: 'unavailable',
          transactionAttempts: 0,
          transactionRetries: 0,
        }),
      })
    );
  });
});
