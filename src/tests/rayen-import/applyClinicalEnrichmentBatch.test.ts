import { describe, expect, it, vi } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createDependencies, operations, record } from './applyClinicalEnrichmentBatch.fixtures';

describe('applyClinicalEnrichmentBatch', () => {
  it('uses one enforced mutation and refreshes local state after success', async () => {
    const deps = createDependencies();
    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(1);
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      patientWrites: 1,
      historySnapshots: 1,
      retries: 0,
      persistence: {
        scope: 'current',
        callableAttempts: 1,
        clientRetries: 0,
        transactionRetries: 0,
      },
      batch: { parity: 'matched', clinicalTargets: 2, checkpointOnlyTargets: 0 },
    });
  });

  it('does not count an idempotent replay as a committed write or snapshot', async () => {
    const deps = createDependencies();
    deps.invoke.mockImplementation(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
      success: true,
      authorityStatus: 'idempotent' as const,
      date: payload.date,
      mode: payload.mode,
      targetCount: payload.patches.length,
      fieldCount:
        payload.patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
        (payload.checkpoints?.length ?? 0),
      resultParity: 'matched' as const,
      patientWrites: 0,
      historySnapshots: 0,
    }));

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.refreshRecord).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ patientWrites: 0, historySnapshots: 0, retries: 0 });
    expect(result).not.toHaveProperty('persistence');
  });

  it('accepts an exact idempotent replay from a pre-parity backend during rollout', async () => {
    const deps = createDependencies();
    deps.invoke.mockImplementation(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
      success: true,
      authorityStatus: 'idempotent' as const,
      date: payload.date,
      mode: payload.mode,
      targetCount: new Set([
        ...payload.patches.map(patch => `${patch.bedId}:${patch.clinicalEpisodeId}`),
        ...(payload.checkpoints ?? []).map(
          checkpoint => `${checkpoint.bedId}:${checkpoint.clinicalEpisodeId}`
        ),
      ]).size,
      fieldCount:
        payload.patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
        (payload.checkpoints?.length ?? 0),
      patientWrites: 0,
      historySnapshots: 0,
    }));

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-idempotent-pre-parity',
      operations,
      ...deps,
    });

    expect(result).toMatchObject({
      patientWrites: 0,
      historySnapshots: 0,
      batch: { parity: 'matched' },
    });
    expect(result).not.toHaveProperty('persistence');
  });

  it('rejects a resolved response that does not confirm the requested batch', async () => {
    const deps = createDependencies();
    deps.invoke.mockResolvedValue({ success: false });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations,
        ...deps,
      })
    ).rejects.toThrow('confirmación inválida');
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
  });

  it('rejects a null backend response with the controlled confirmation error', async () => {
    const deps = createDependencies();
    deps.invoke.mockResolvedValue(null as never);

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-null-response',
        operations,
        ...deps,
      })
    ).rejects.toThrow('confirmación inválida');
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
  });

  it('blocks enforced mode when the backend result does not match the requested values', async () => {
    const deps = createDependencies();
    deps.invoke.mockImplementation(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
      success: true,
      authorityStatus: 'ok' as const,
      date: payload.date,
      mode: payload.mode,
      targetCount: 2,
      fieldCount: 3,
      resultParity: 'mismatch' as const,
      patientWrites: 0,
      historySnapshots: 0,
    }));

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-enforced-mismatch',
        operations,
        ...deps,
      })
    ).rejects.toThrow('no confirmó paridad');
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('retries a transient failure with the same mutation identity', async () => {
    const deps = createDependencies();
    deps.invoke.mockRejectedValueOnce({ code: 'functions/unavailable' });
    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[0]?.[0].mutationId).toBe('mutation-fixed');
    expect(deps.invoke.mock.calls[1]?.[0].mutationId).toBe('mutation-fixed');
    expect(result.retries).toBe(1);
  });

  it('rebuilds canonical record-derived fields after a version conflict', async () => {
    const deps = createDependencies();
    const refreshedRecord = {
      ...record,
      lastUpdated: '2026-07-28T10:02:00.000Z',
      meta: { revision: 8 },
    } as DailyRecord;
    const rebuiltOperations: ClinicalFillPatchOperation[] = [
      {
        target: operations[0].target,
        patch: {
          'beds.H2C1.evaluationScores': {
            braden: { total: 20 },
            cudyr: { category: 'C1' },
          },
        },
      },
    ];
    const rebuildOperations = vi.fn(() => rebuiltOperations);
    deps.refreshRecord.mockResolvedValue(refreshedRecord);
    deps.invoke.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'revision_mismatch',
    });

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-rebuild',
      operations: [operations[0]],
      rebuildOperations,
      ...deps,
    });

    expect(rebuildOperations).toHaveBeenCalledWith(refreshedRecord);
    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        mutationId: 'mutation-fixed',
        baseRevision: 8,
        patches: [
          expect.objectContaining({
            fields: {
              evaluationScores: {
                braden: { total: 20 },
                cudyr: { category: 'C1' },
              },
            },
          }),
        ],
      })
    );
    expect(result.retries).toBe(1);
  });

  it('settles a version conflict when rebuilding proves the desired value is current', async () => {
    const deps = createDependencies();
    const rebuildOperations = vi
      .fn((): ClinicalFillPatchOperation[] => [])
      .mockReturnValueOnce([operations[0]]);
    deps.invoke.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'revision_mismatch',
    });

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-already-current',
      operations: [operations[0]],
      rebuildOperations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      patientWrites: 0,
      historySnapshots: 0,
      retries: 1,
      batch: { requestedFields: 0 },
    });
  });

  it('does not fall back after an ambiguous availability failure', async () => {
    const deps = createDependencies();
    deps.invoke.mockRejectedValue({ code: 'functions/unavailable' });

    const failure = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'functions/unavailable',
      clinicalBatchRetries: 1,
    });
    expect(failure).not.toHaveProperty('clinicalPersistenceEvidence');

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('does not fall back when an ambiguous attempt is followed by a missing endpoint', async () => {
    const deps = createDependencies();
    deps.invoke
      .mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockRejectedValueOnce({ code: 'functions/not-found' });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations,
        ...deps,
      })
    ).rejects.toMatchObject({ code: 'functions/not-found' });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('fails closed when the enforced callable is definitively unavailable', async () => {
    const deps = createDependencies();
    deps.invoke.mockRejectedValue({ code: 'functions/not-found' });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations,
        ...deps,
      })
    ).rejects.toMatchObject({ code: 'functions/not-found' });

    expect(deps.invoke).toHaveBeenCalledTimes(1);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('settles an empty enforced batch without invoking either persistence owner', async () => {
    const deps = createDependencies();
    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-empty',
      operations: [],
      ...deps,
    });

    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      patientWrites: 0,
      historySnapshots: 0,
      batch: { mode: 'enforced', requestedFields: 0 },
    });
  });

  it('never falls back around an authority or concurrency rejection', async () => {
    const deps = createDependencies();
    deps.invoke.mockRejectedValue({ code: 'functions/failed-precondition' });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations,
        ...deps,
      })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});
