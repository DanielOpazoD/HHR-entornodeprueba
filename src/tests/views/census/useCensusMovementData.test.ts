import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { useDailyRecordStaff, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStaff: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useCensusMovementData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns record date and movement buckets from fragmented context hooks', () => {
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordStaff>>({
        date: '2026-02-15',
      })
    );
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordMovements>>({
        discharges: [DataFactory.createMockDischarge({ id: 'd1' })],
        transfers: [DataFactory.createMockTransfer({ id: 't1' })],
        cma: [DataFactory.createMockCMA({ id: 'c1' })],
      })
    );

    const { result } = renderHook(() => useCensusMovementData());

    expect(result.current.recordDate).toBe('2026-02-15');
    expect(result.current.discharges).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'd1' })])
    );
    expect(result.current.transfers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 't1' })])
    );
    expect(result.current.cma).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'c1' })])
    );
  });

  it('returns safe defaults when record and movements are absent', () => {
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordStaff>>({
        date: undefined,
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
