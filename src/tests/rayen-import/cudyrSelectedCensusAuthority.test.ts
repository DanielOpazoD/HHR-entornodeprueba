import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type {
  ClinicalFillDeps,
  HistoricalCudyrBatchItem,
} from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';

describe('CUDYR selected census authority', () => {
  it('reads on the following morning but archives and projects into the selected census night', async () => {
    const record = {
      date: '2026-10-10',
      beds: { R1: { bedId: 'R1', patientName: 'Paciente sintético', clinicalEpisodeId: 'E1' } },
      discharges: [],
      transfers: [],
      cma: [],
      rayenSync: { runId: 'selected-run' },
    } as unknown as DailyRecord;
    const current = { id: 'current', category: 'C2', recordedAt: '2026-10-11T03:00:00-05:00' };
    const previous = { id: 'previous', category: 'D3', recordedAt: '2026-10-10T03:00:00-05:00' };
    const archive = vi.fn(async (request: ArchiveCudyrHistoryRequest) => {
      if (request.authorityDate !== record.date)
        throw new Error('Synchronization census is missing.');
      return 'persisted' as const;
    });
    const historical = vi.fn(async (_day: string, items: HistoricalCudyrBatchItem[]) =>
      items.map(item => ({
        clinicalEpisodeId: item.clinicalEpisodeId,
        persisted: true,
        changed: false,
      }))
    );
    const deps: ClinicalFillDeps = {
      diagnosticRunId: 'selected-run',
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        source: 'gestion_camas',
        historyAvailable: true,
        captureContract: 1,
        metadataStatus: 'complete',
        observedEpisodeIds: ['E1'],
        items: [
          {
            encId: 'E1',
            source: 'gestion_camas',
            crdValue: 'C2',
            crdDateTime: current.recordedAt,
            history: [current, previous],
            observations: [current, previous],
          },
        ],
      }),
      archiveCudyrCapture: archive,
      applyHistoricalCudyrBatch: historical,
      fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      applyPatch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date('2026-10-11T09:09:00-05:00'),
      createId: () => '00000000-0000-4000-8000-000000000001',
    };
    const summary = await runClinicalFill(record, '2026-10-11', deps);
    expect(summary.errors).toEqual([]);
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({ authorityDate: '2026-10-10', runId: 'selected-run' })
    );
    expect(historical).toHaveBeenCalledWith('2026-10-09', [
      expect.objectContaining({ cudyr: expect.objectContaining({ category: 'D3' }) }),
    ]);
    expect(deps.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        'beds.R1.evaluationScores': expect.objectContaining({
          cudyr: expect.objectContaining({ category: 'C2' }),
        }),
      }),
      expect.anything()
    );
    expect(deps.fetchHistoryScales).toHaveBeenCalledWith('E1', '2026-10-11', expect.anything());
  });
});
