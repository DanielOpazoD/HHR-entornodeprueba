import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolveClinicalStageResult } from '@/features/rayen-import/domain/clinicalStageResolution';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import {
  currentDay,
  historicalDay,
  now,
  parsedSource,
  patient,
} from './dailyCudyrRecovery.fixtures';

describe('retry of an inconclusive documentary CUDYR read', () => {
  it('keeps the discharged episode pending and retries only CUDYR before proposing a recovered value', async () => {
    const previous = historicalDay();
    const current = currentDay();
    current.beds = {};
    const missing = parsedSource();
    missing.report.patients = [];
    const capture = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(parsedSource());
    const recoverMissingCudyr = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async date => (date === previous.date ? previous : null),
      capture,
    });
    const episode = patient().clinicalEpisodeId;
    const applyHistoricalCudyrBatch = vi
      .fn<NonNullable<ClinicalFillDeps['applyHistoricalCudyrBatch']>>()
      .mockImplementation(async (_date, items) =>
        items.map(item => ({
          clinicalEpisodeId: item.clinicalEpisodeId,
          persisted: true,
          changed: true,
        }))
      );
    const deps: ClinicalFillDeps = {
      recoverMissingCudyr,
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        source: 'gestion_camas',
        historyAvailable: true,
        captureContract: 1,
        observedEpisodeIds: [],
        metadataStatus: 'complete',
        items: [],
      }),
      fetchDeviceReport: vi.fn(),
      extractDeviceItems: vi.fn(),
      fetchHistoryScales: vi.fn(),
      fetchScalesForms: vi.fn(),
      applyPatch: vi.fn(),
      historicalCudyrEpisodeIds: [episode],
      pendingReads: { [episode]: ['cudyr'] },
      applyHistoricalCudyrBatch,
      now,
      createId: () => 'synthetic-recovery-retry',
    };
    const failed = await runClinicalFill(current, current.date, deps);
    expect(failed.errors).toEqual([
      expect.objectContaining({
        clinicalEpisodeId: episode,
        source: 'cudyr',
        reason: 'source_unavailable',
      }),
    ]);
    expect(applyHistoricalCudyrBatch).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
    const stage = resolveClinicalStageResult(
      current,
      current,
      undefined,
      failed,
      false,
      [],
      [episode]
    );
    expect(stage.status).toBe('partial');
    if (stage.status === 'complete' || !stage.retry) throw new Error('Missing CUDYR retry');
    expect(stage.retry.pendingClinicalEpisodeIds).toEqual([]);
    expect(stage.retry.pendingHistoricalCudyrEpisodeIds).toEqual([episode]);
    const recovered = await runClinicalFill(current, current.date, {
      ...deps,
      allowedClinicalEpisodeIds: stage.retry.pendingClinicalEpisodeIds,
      historicalCudyrEpisodeIds: stage.retry.pendingHistoricalCudyrEpisodeIds,
      pendingReads: stage.retry.pendingReads,
    });
    expect(recovered.errors).toEqual([]);
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledExactlyOnceWith(previous.date, [
      {
        clinicalEpisodeId: episode,
        cudyr: expect.objectContaining({ category: 'C2', recordedDate: previous.date }),
      },
    ]);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(deps.fetchCudyrCategories).toHaveBeenCalledTimes(2);
    expect(deps.fetchDeviceReport).not.toHaveBeenCalled();
    expect(deps.fetchHistoryScales).not.toHaveBeenCalled();
    expect(deps.fetchScalesForms).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(current.discharges).toEqual(currentDay().discharges);
    expect(
      resolveClinicalStageResult(current, current, undefined, recovered, false, [], [episode])
        .status
    ).toBe('complete');
  });
});
