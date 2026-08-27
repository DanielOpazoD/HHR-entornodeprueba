import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { BedDefinition } from '@/types/domain/beds';
import { useAdminCudyrBulkRemoval } from '@/features/cudyr/hooks/useAdminCudyrBulkRemoval';

const makeRecord = (date = '2026-08-26') =>
  ({
    date,
    beds: {
      H3C2: {
        clinicalEpisodeId: 'episode-1',
        evaluationScores: {
          cudyr: { category: 'C1', recordedDate: date, source: 'Eloísa' },
        },
        clinicalCrib: {
          clinicalEpisodeId: 'crib-episode-1',
          evaluationScores: {
            cudyr: { category: 'D2', recordedDate: date, source: 'Eloísa' },
          },
        },
      },
      H5C1: {
        clinicalEpisodeId: 'episode-2',
        evaluationScores: {
          cudyr: { category: 'B1', recordedDate: '2026-08-25', source: 'Eloísa' },
        },
      },
    },
  }) as unknown as DailyRecord;

const visibleBeds = [{ id: 'H3C2' }, { id: 'H5C1' }] as BedDefinition[];

describe('useAdminCudyrBulkRemoval', () => {
  const onSelectionInvalidated = vi.fn();

  it('selects every current imported result, including a clinical crib', () => {
    const saveResults = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useAdminCudyrBulkRemoval({
        record: makeRecord(),
        visibleBeds,
        saveResults,
        onSelectionInvalidated,
      })
    );

    expect(result.current.targets).toHaveLength(2);
    act(() => result.current.start());
    act(() => result.current.selectAll());
    expect([...result.current.selected.keys()]).toEqual(['H3C2:bed', 'H3C2:crib']);
  });

  it('submits all selected removals in a single request and exits selection mode', async () => {
    const saveResults = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useAdminCudyrBulkRemoval({
        record: makeRecord(),
        visibleBeds,
        saveResults,
        onSelectionInvalidated,
      })
    );

    act(() => result.current.start());
    act(() => result.current.selectAll());
    await act(() => result.current.confirm());

    expect(saveResults).toHaveBeenCalledOnce();
    expect(saveResults.mock.calls[0][0]).toHaveLength(2);
    expect(saveResults.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bedId: 'H3C2', clinicalCrib: false, category: null }),
        expect.objectContaining({ bedId: 'H3C2', clinicalCrib: true, category: null }),
      ])
    );
    expect(result.current.isActive).toBe(false);
  });

  it('does not carry selections into another census date', () => {
    const saveResults = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(
      ({ record }) =>
        useAdminCudyrBulkRemoval({
          record,
          visibleBeds,
          saveResults,
          onSelectionInvalidated,
        }),
      { initialProps: { record: makeRecord() } }
    );

    act(() => result.current.start());
    act(() => result.current.selectAll());
    rerender({ record: makeRecord('2026-08-27') });

    expect(result.current.isActive).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });

  it('cancels a stale selection when the same bed refreshes before confirmation', async () => {
    const saveResults = vi.fn().mockResolvedValue(false);
    const initialRecord = makeRecord();
    const { result, rerender } = renderHook(
      ({ record }) =>
        useAdminCudyrBulkRemoval({
          record,
          visibleBeds,
          saveResults,
          onSelectionInvalidated,
        }),
      { initialProps: { record: initialRecord } }
    );

    act(() => result.current.start());
    act(() => result.current.selectAll());
    const refreshedRecord = {
      ...initialRecord,
      beds: {
        ...initialRecord.beds,
        H3C2: {
          ...initialRecord.beds.H3C2,
          clinicalEpisodeId: 'replacement-episode',
        },
      },
    } as DailyRecord;
    rerender({ record: refreshedRecord });
    await act(() => result.current.confirm());

    expect(saveResults).not.toHaveBeenCalled();
    expect(onSelectionInvalidated).toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
  });
});
