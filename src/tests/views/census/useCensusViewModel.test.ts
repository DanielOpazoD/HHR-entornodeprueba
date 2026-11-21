import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusViewModel } from '@/features/census/hooks/useCensusViewModel';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import { useTableConfig } from '@/context/TableConfigContext';

vi.mock('@/hooks/useCensusLogic');
vi.mock('@/context/TableConfigContext');

describe('useCensusViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty visible beds when record does not exist', () => {
    vi.mocked(useCensusLogic).mockReturnValue({
      beds: null,
      staff: {
        nursesDayShift: [],
        nursesNightShift: [],
        tensDayShift: [],
        tensNightShift: [],
        activeExtraBeds: [],
      },
      stats: null,
      previousRecordAvailable: false,
      previousRecordDate: undefined,
      createDay: vi.fn(),
    } as ReturnType<typeof useCensusLogic>);
    vi.mocked(useTableConfig).mockReturnValue({ config: { pageMargin: 24 } } as ReturnType<
      typeof useTableConfig
    >);

    const { result } = renderHook(() => useCensusViewModel('2026-02-15'));

    expect(result.current.visibleBeds).toEqual([]);
    expect(result.current.marginStyle).toEqual({ padding: '0 24px' });
  });

  it('builds visible beds from active extra beds', () => {
    vi.mocked(useCensusLogic).mockReturnValue({
      beds: {},
      staff: {
        nursesDayShift: [],
        nursesNightShift: [],
        tensDayShift: [],
        tensNightShift: [],
        activeExtraBeds: ['E1'],
      },
      stats: null,
      previousRecordAvailable: false,
      previousRecordDate: undefined,
      createDay: vi.fn(),
    } as ReturnType<typeof useCensusLogic>);
    vi.mocked(useTableConfig).mockReturnValue({ config: { pageMargin: 20 } } as ReturnType<
      typeof useTableConfig
    >);

    const { result } = renderHook(() => useCensusViewModel('2026-02-15'));

    expect(result.current.visibleBeds.some(bed => bed.id === 'E1')).toBe(true);
  });
});
