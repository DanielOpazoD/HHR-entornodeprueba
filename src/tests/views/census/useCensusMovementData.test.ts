import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { useDailyRecordData, useDailyRecordMovements } from '@/context/DailyRecordContext';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useCensusMovementData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns record date and movement buckets from fragmented context hooks', () => {
    vi.mocked(useDailyRecordData).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordData>>({
        record: { date: '2026-02-15' } as any,
      })
    );
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordMovements>>({
        discharges: [{ id: 'd1' }] as any,
        transfers: [{ id: 't1' }] as any,
        cma: [{ id: 'c1' }] as any,
      })
    );

    const { result } = renderHook(() => useCensusMovementData());

    expect(result.current.recordDate).toBe('2026-02-15');
    expect(result.current.discharges).toEqual([{ id: 'd1' }]);
    expect(result.current.transfers).toEqual([{ id: 't1' }]);
    expect(result.current.cma).toEqual([{ id: 'c1' }]);
  });

  it('returns safe defaults when record and movements are absent', () => {
    vi.mocked(useDailyRecordData).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordData>>({
        record: null,
      })
    );
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      null as ReturnType<typeof useDailyRecordMovements>
    );

    const { result } = renderHook(() => useCensusMovementData());

    expect(result.current.recordDate).toBe('');
    expect(result.current.discharges).toBeUndefined();
    expect(result.current.transfers).toBeUndefined();
    expect(result.current.cma).toBeUndefined();
  });
});
