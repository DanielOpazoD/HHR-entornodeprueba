import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

const mocks = vi.hoisted(() => ({
  beginRayenFill: vi.fn(),
  endRayenFill: vi.fn(),
  reportRayenFillProgress: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  beginRayenFill: mocks.beginRayenFill,
  endRayenFill: mocks.endRayenFill,
  reportRayenFillProgress: mocks.reportRayenFillProgress,
}));

describe('useRayenClinicalFill', () => {
  it('settles an applied run as partial when the single-flight guard rejects it', async () => {
    mocks.beginRayenFill.mockReturnValue(false);
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const onSettled = vi.fn();
    const record = {
      date: '2026-07-14',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
      },
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      useRayenClinicalFill({
        nurseCatalog: [],
        patchDailyRecord: vi.fn(),
        applyHistoricalCudyr: vi.fn().mockResolvedValue({ persisted: false, changed: false }),
        completeRun,
        onStaffingProposal: vi.fn(),
        onSettled,
        createId: () => 'id',
      })
    );

    await act(async () => {
      await result.current(record);
    });

    expect(completeRun).toHaveBeenCalledWith(record, {
      total: 1,
      patched: 0,
      errors: [{ bedId: '*', source: 'patch', message: 'clinical_fill_busy' }],
    });
    expect(onSettled).toHaveBeenCalledOnce();
    expect(mocks.endRayenFill).not.toHaveBeenCalled();
  });
});
