import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { RayenCudyrCategoriesResponse } from '@/features/rayen-import/contracts/rayenCudyr';
import { buildImportedCudyr } from '@/domain/evaluationScales/importedCudyr';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const episode = 'synthetic-discharged-episode';
const row = {
  encId: episode,
  source: 'gestion_camas' as const,
  crdValue: 'C2',
  crdDateTime: '2026-10-27T03:00:00-05:00',
};
const stored = buildImportedCudyr(row, '2026-10-26');
const response = (): RayenCudyrCategoriesResponse => ({
  items: [],
  source: 'gestion_camas',
  historyAvailable: true,
  captureContract: 1,
  observedEpisodeIds: [],
  metadataStatus: 'complete',
});
const census = (date = '2026-10-26') => ({
  ...buildInitializedDayRecord(date, null),
  beds: {
    R1: {
      ...createEmptyPatient('R1'),
      patientName: 'Paciente sintético',
      clinicalEpisodeId: episode,
      evaluationScores: { ...(stored ? { cudyr: stored } : {}) },
    },
  },
});
const dependencies = (source = response()) => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue(source),
  applyPatch: vi.fn<ClinicalFillDeps['applyPatch']>().mockResolvedValue(undefined),
  applyHistoricalCudyr: vi.fn().mockResolvedValue({ persisted: true, changed: true }),
  archiveCudyrCapture: vi.fn().mockResolvedValue('persisted'),
  diagnosticRunId: 'synthetic-late-sync',
  now: () => new Date('2026-10-27T20:00:00-05:00'),
  createId: () => '00000000-0000-4000-8000-000000000026',
});

describe('CUDYR synchronization after the episode leaves current beds', () => {
  it.each(['missing', 'other-episode', 'legacy', 'legacy-observed'])(
    'preserves the accepted night result with a %s source row',
    async kind => {
      const source = response();
      if (kind === 'other-episode') source.items = [{ ...row, encId: 'synthetic-new-episode' }];
      if (kind.startsWith('legacy')) source.captureContract = undefined;
      if (kind === 'legacy-observed') source.observedEpisodeIds = [episode];
      const rec = census();
      const before = structuredClone(rec);
      const deps = dependencies(source);
      await runClinicalFill(rec, rec.date, deps);

      expect(stored).toMatchObject({ category: 'C2', recordedDate: '2026-10-26' });
      expect(deps.applyPatch).toHaveBeenCalled();
      for (const [patch] of deps.applyPatch.mock.calls) {
        expect(patch).not.toHaveProperty('beds.R1.evaluationScores');
      }
      expect(deps.applyHistoricalCudyr).not.toHaveBeenCalled();
      expect(rec).toEqual(before);
      expect(deps.archiveCudyrCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluations: [],
          capture: expect.objectContaining({
            clinicalEpisodeId: episode,
            status: kind.startsWith('legacy') ? 'legacy_extension' : 'not_observed',
          }),
        })
      );
    }
  );

  it('archives a recovered morning result on the previous night, not the late-created day', async () => {
    const rec = census('2026-10-27');
    rec.beds.R1.evaluationScores = {};
    const deps = dependencies({ ...response(), items: [row], observedEpisodeIds: [episode] });
    const result = await runClinicalFill(rec, rec.date, deps);

    expect(result.errors).toEqual([]);
    expect(deps.applyHistoricalCudyr).toHaveBeenCalledExactlyOnceWith(
      episode,
      '2026-10-26',
      expect.objectContaining({ category: 'C2', recordedAt: row.crdDateTime })
    );
    for (const [patch] of deps.applyPatch.mock.calls) {
      expect(patch).not.toHaveProperty('beds.R1.evaluationScores');
    }
  });

  it('does not invent a CUDYR when neither HHR nor the current source has captured it', async () => {
    const rec = census();
    rec.beds.R1.evaluationScores = {};
    const deps = dependencies();
    await runClinicalFill(rec, rec.date, deps);

    for (const [patch] of deps.applyPatch.mock.calls) {
      expect(patch).not.toHaveProperty('beds.R1.evaluationScores');
    }
    expect(deps.applyHistoricalCudyr).not.toHaveBeenCalled();
    expect(deps.archiveCudyrCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluations: [],
        capture: expect.objectContaining({ status: 'not_observed' }),
      })
    );
  });

  it('keeps explicit official empty-history authority for an observed episode without a category row', async () => {
    const rec = census();
    const deps = dependencies({ ...response(), observedEpisodeIds: [episode] });
    await runClinicalFill(rec, rec.date, deps);

    expect(deps.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({ 'beds.R1.evaluationScores': {} }),
      expect.anything()
    );
    expect(deps.archiveCudyrCapture).toHaveBeenCalledWith(
      expect.objectContaining({ capture: expect.objectContaining({ status: 'observed' }) })
    );
  });
});
