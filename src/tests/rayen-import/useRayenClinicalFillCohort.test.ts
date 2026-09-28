import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as runner from '@/features/rayen-import/clinicalFillRunner';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import type {
  ClinicalRetryToken,
  ClinicalStageResult,
} from '@/features/rayen-import/contracts/clinicalStageResult';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  beginRayenFill: vi.fn(() => true),
  endRayenFill: vi.fn(),
  getRayenFillAttemptId: vi.fn(() => 1),
  reportRayenFillProgress: vi.fn(),
  registerRayenFillAbort: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  resetRayenClinicalFillQueueForTests();
});

const census = (ids: string[]): DailyRecord =>
  ({
    date: '2026-07-14',
    beds: Object.fromEntries(
      ids.map((id, index) => [
        `R${index + 1}`,
        {
          bedId: `R${index + 1}`,
          patientName: 'Paciente sintético',
          clinicalEpisodeId: id,
        },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
    rayenSync: { runId: 'original-run' },
    rayenSyncHistory: [
      {
        id: 'original-run',
        status: 'applied',
        startedAt: '2026-07-14T10:00:00Z',
        by: 'Operador sintético',
        policy: { mode: 'preview', revision: 1 },
      },
    ],
  }) as unknown as DailyRecord;

describe('legacy clinical retry cohort', () => {
  it('keeps the original episodes through repeated failures after new admissions appear', async () => {
    const original = census(['original']);
    const read = vi.fn().mockResolvedValue(census(['original', 'new-admission']));
    const fill = vi.spyOn(runner, 'runClinicalFill').mockResolvedValue({
      total: 1,
      patched: 0,
      errors: [
        {
          bedId: 'R1',
          clinicalEpisodeId: 'original',
          source: 'patch',
          reason: 'write_failed',
          message: 'temporary write failure',
        },
      ],
    });
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        tensCatalog: [],
        loadDailyRecord: read,
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn(),
        completeRun: vi.fn(),
        onStaffingProposal: vi.fn(),
        createId: () => 'id',
      })
    );
    let retryRequest: ClinicalRetryToken = {
      type: 'clinical_retry',
      source: original,
      pendingClinicalEpisodeIds: ['original'],
      pendingReads: { original: ['cudyr'] },
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let outcome!: ClinicalStageResult;
      await act(async () => {
        outcome = await result.current(retryRequest);
      });
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'complete' || !outcome.retry) throw new Error('Expected retry');
      retryRequest = outcome.retry;
      expect(retryRequest.source).toBe(original);
      expect(retryRequest.pendingClinicalEpisodeIds).toEqual(['original']);
      expect(fill).toHaveBeenLastCalledWith(
        expect.objectContaining({ beds: expect.objectContaining({ R2: expect.anything() }) }),
        original.date,
        expect.objectContaining({ allowedClinicalEpisodeIds: ['original'] }),
        expect.any(Function)
      );
      read.mockResolvedValue(census(['original', 'new-admission', 'another-admission']));
    }
  });
});
