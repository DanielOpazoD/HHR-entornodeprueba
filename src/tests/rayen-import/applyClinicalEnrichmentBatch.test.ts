import { describe, expect, it, vi } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = {
  date: '2026-07-28',
  lastUpdated: '2026-07-28T10:00:00.000Z',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  meta: { revision: 7 },
} as unknown as DailyRecord;

const operations: ClinicalFillPatchOperation[] = [
  {
    target: {
      censusDate: '2026-07-28',
      bedId: 'H2C1',
      clinicalEpisodeId: 'episode-1',
    },
    patch: {
      'beds.H2C1.evaluationScores': { braden: { total: 17 } },
      'beds.H2C1.clinicalSyncCheckpoint': { version: 1, sources: {} },
    },
  },
  {
    target: {
      censusDate: '2026-07-28',
      bedId: 'H2C2',
      clinicalEpisodeId: 'episode-2',
    },
    patch: { 'beds.H2C2.vitalSigns': { systolic: 120 } },
  },
];

const dependencies = () => ({
  applyPatch: vi.fn().mockResolvedValue(undefined),
  refreshRecord: vi.fn().mockResolvedValue(record),
  invoke: vi.fn().mockImplementation(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
    success: true,
    authorityStatus: 'ok' as const,
    date: payload.date,
    mode: payload.mode,
    targetCount: payload.patches.length,
    fieldCount:
      payload.patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
      (payload.checkpoints?.length ?? 0),
    resultParity: 'matched' as const,
    patientWrites: 1,
    historySnapshots: 1,
  })),
  createMutationId: vi.fn(() => 'mutation-fixed'),
});

describe('applyClinicalEnrichmentBatch', () => {
  it('keeps off mode on the established sequential path with one history snapshot', async () => {
    const deps = dependencies();
    const result = await applyClinicalEnrichmentBatch({
      mode: 'off',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch.mock.calls[0]?.[0].target.captureHistorySnapshot).toBe(true);
    expect(deps.applyPatch.mock.calls[1]?.[0].target.captureHistorySnapshot).toBe(false);
    expect(result).toEqual({ patientWrites: 2, historySnapshots: 1 });
  });

  it('validates in shadow but persists through the established path', async () => {
    const deps = dependencies();
    const result = await applyClinicalEnrichmentBatch({
      mode: 'shadow',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        mutationId: 'mutation-fixed',
        mode: 'shadow',
        dryRun: true,
        baseRevision: 7,
        patches: [
          expect.objectContaining({
            bedId: 'H2C1',
            clinicalEpisodeId: 'episode-1',
            fields: expect.objectContaining({ evaluationScores: expect.anything() }),
          }),
          expect.objectContaining({ bedId: 'H2C2', clinicalEpisodeId: 'episode-2' }),
        ],
      })
    );
    const payload = deps.invoke.mock.calls[0]?.[0];
    expect(payload.checkpoints).toBeUndefined();
    expect(payload.patches[0]?.fields).toHaveProperty(
      'clinicalSyncCheckpoint',
      expect.objectContaining({ version: 1 })
    );
    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch.mock.invocationCallOrder.at(-1)).toBeLessThan(
      deps.invoke.mock.invocationCallOrder[0]
    );
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
    expect(result.patientWrites).toBe(2);
  });

  it('builds shadow guards from the record refreshed after legacy writes', async () => {
    const deps = dependencies();
    deps.refreshRecord.mockResolvedValue({
      ...record,
      lastUpdated: '2026-07-28T10:01:00.000Z',
      meta: { revision: 9 },
    });

    await applyClinicalEnrichmentBatch({
      mode: 'shadow',
      record,
      runId: 'run-shadow-fresh',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLastUpdated: '2026-07-28T10:01:00.000Z',
        baseRevision: 9,
      })
    );
  });

  it('uses one enforced mutation and refreshes local state after success', async () => {
    const deps = dependencies();
    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(1);
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      patientWrites: 1,
      historySnapshots: 1,
      retries: 0,
      batch: { parity: 'matched', clinicalTargets: 2, checkpointOnlyTargets: 0 },
    });
  });

  it('does not count an idempotent replay as a committed write or snapshot', async () => {
    const deps = dependencies();
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

    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ patientWrites: 0, historySnapshots: 0, retries: 0 });
  });

  it('rejects a resolved response that does not confirm the requested batch', async () => {
    const deps = dependencies();
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
    expect(deps.refreshRecord).not.toHaveBeenCalled();
  });

  it('rejects a null backend response with the controlled confirmation error', async () => {
    const deps = dependencies();
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
    expect(deps.refreshRecord).not.toHaveBeenCalled();
  });

  it('records a semantic shadow mismatch without blocking established writes', async () => {
    const deps = dependencies();
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

    const result = await applyClinicalEnrichmentBatch({
      mode: 'shadow',
      record,
      runId: 'run-shadow-mismatch',
      operations,
      ...deps,
    });

    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
    expect(result.batch?.parity).toBe('mismatch');
  });

  it('blocks enforced mode when the backend result does not match the requested values', async () => {
    const deps = dependencies();
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
    const deps = dependencies();
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

  it('does not fall back after an ambiguous availability failure', async () => {
    const deps = dependencies();
    deps.invoke.mockRejectedValue({ code: 'functions/unavailable' });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations,
        ...deps,
      })
    ).rejects.toMatchObject({ code: 'functions/unavailable', clinicalBatchRetries: 1 });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('does not fall back when an ambiguous attempt is followed by a missing endpoint', async () => {
    const deps = dependencies();
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

  it('falls back only when the callable is definitively unavailable', async () => {
    const deps = dependencies();
    deps.invoke.mockRejectedValue({ code: 'functions/not-found' });

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(1);
    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ patientWrites: 2, historySnapshots: 1, retries: 1 });
  });

  it('uses the established path when the serialized batch exceeds the callable budget', async () => {
    const deps = dependencies();
    const oversized: ClinicalFillPatchOperation[] = [
      {
        target: operations[0].target,
        patch: {
          'beds.H2C1.deviceDetails': { oversized: 'x'.repeat(510_000) },
        },
      },
    ];

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-large',
      operations: oversized,
      ...deps,
    });

    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ patientWrites: 1, historySnapshots: 1 });
  });

  it('continues legacy writes after one patient fails and snapshots the first success', async () => {
    const deps = dependencies();
    deps.applyPatch
      .mockRejectedValueOnce(new Error('conflicto paciente 1'))
      .mockResolvedValueOnce(undefined);

    const result = await applyClinicalEnrichmentBatch({
      mode: 'off',
      record,
      runId: 'run-1',
      operations,
      ...deps,
    });

    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch.mock.calls[0]?.[0].target.captureHistorySnapshot).toBe(true);
    expect(deps.applyPatch.mock.calls[1]?.[0].target.captureHistorySnapshot).toBe(true);
    expect(result).toEqual({
      patientWrites: 1,
      historySnapshots: 1,
      failures: [{ index: 0, message: 'conflicto paciente 1' }],
    });
  });

  it('never falls back around an authority or concurrency rejection', async () => {
    const deps = dependencies();
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

  it('rejects a route outside the operation target before invoking the backend', async () => {
    const deps = dependencies();
    const invalid = [
      {
        ...operations[0],
        patch: { 'beds.H9C9.patientName': 'No permitido' },
      },
    ];

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations: invalid,
        ...deps,
      })
    ).rejects.toThrow('ruta fuera del paciente');
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});
