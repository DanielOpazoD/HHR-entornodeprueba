import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import { describe, expect, it, vi } from 'vitest';
import { resolveHistoricalCudyrBatchOperation } from '@/features/rayen-import/domain/historicalCudyrPatch';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { applyPatches } from '@/utils/patchUtils';

describe('daily sync recovers the prior night after discharge', () => {
  it('updates the owning census even when the episode is only a discharge in the selected day', async () => {
    const patient = {
      ...createEmptyPatient('R1'),
      clinicalEpisodeId: 'synthetic-discharged-episode',
      patientName: 'Paciente sintético',
    };
    let historical = { ...buildInitializedDayRecord('2026-10-26', null), beds: { R1: patient } };
    const current = buildInitializedDayRecord('2026-10-27', null);
    current.discharges = [
      {
        id: 'synthetic-discharge',
        clinicalEpisodeId: patient.clinicalEpisodeId,
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Intermedia',
        patientName: patient.patientName,
        rut: 'synthetic-document',
        diagnosis: '',
        time: '14:00',
        movementDate: current.date,
        status: 'Vivo',
        originalData: patient,
      },
    ];
    const before = structuredClone(current);
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn(),
      extractDeviceItems: vi.fn(),
      fetchHistoryScales: vi.fn(),
      fetchScalesForms: vi.fn(),
      applyPatch: vi.fn(),
      fetchCudyrCategories: async () => ({
        source: 'gestion_camas',
        historyAvailable: true,
        captureContract: 1,
        observedEpisodeIds: [patient.clinicalEpisodeId],
        metadataStatus: 'complete',
        items: [
          {
            encId: patient.clinicalEpisodeId,
            source: 'gestion_camas',
            crdValue: 'C2',
            crdDateTime: '2026-10-27T03:00:00-05:00',
          },
        ],
      }),
      archiveCudyrCapture: async () => 'persisted',
      applyHistoricalCudyrBatch: async (day, items) => {
        expect(day).toBe(historical.date);
        return items.map(item => {
          const result = resolveHistoricalCudyrBatchOperation(
            historical,
            item.clinicalEpisodeId,
            item.cudyr
          );
          if (result.operation?.patch)
            historical = applyPatches(historical, result.operation?.patch);
          return {
            clinicalEpisodeId: item.clinicalEpisodeId,
            persisted: result.matched,
            changed: Boolean(result.operation?.patch),
          };
        });
      },
      now: () => new Date('2026-10-27T20:00:00-05:00'),
      createId: () => 'synthetic-late-daily-sync',
    };
    const onProgress = vi.fn();
    const summary = await runClinicalFill(current, current.date, deps, onProgress);
    expect(summary).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 1, total: 1 });
    expect(historical.beds.R1.evaluationScores?.cudyr).toMatchObject({
      category: 'C2',
      recordedDate: '2026-10-26',
      recordedAt: '2026-10-27T03:00:00-05:00',
    });
    expect(current).toEqual(before);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});
