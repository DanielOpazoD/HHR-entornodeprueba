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

describe('Rayen clinical enrichment telemetry', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(JSON.stringify(admin.telemetryAdd.mock.calls[0]?.[0])).not.toMatch(
      /H2C1|episode-secret|Paciente reservado|11\.111|braden|120|run-1|mutation-1/
    );
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
    expect(JSON.stringify(admin.telemetryAdd.mock.calls[0]?.[0])).not.toMatch(
      /H2C1|episode-secret|Paciente reservado|11\.111|evaluationScores|vitalSigns|braden|120/
    );
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
