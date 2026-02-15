import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCensusTableViewModel } from '@/features/census/hooks/useCensusTableViewModel';
import { useCensusTableDependencies } from '@/features/census/hooks/useCensusTableDependencies';
import { useEmptyBedActivation } from '@/features/census/components/useEmptyBedActivation';
import { useCensusTableModel } from '@/features/census/hooks/useCensusTableModel';
import { useCensusColumnResize } from '@/features/census/hooks/useCensusColumnResize';
import { getDefaultConfig } from '@/services/storage/tableConfigService';

vi.mock('@/features/census/hooks/useCensusTableDependencies', () => ({
  useCensusTableDependencies: vi.fn(),
}));

vi.mock('@/features/census/components/useEmptyBedActivation', () => ({
  useEmptyBedActivation: vi.fn(),
}));

vi.mock('@/features/census/hooks/useCensusTableModel', () => ({
  useCensusTableModel: vi.fn(),
}));

vi.mock('@/features/census/hooks/useCensusColumnResize', () => ({
  useCensusColumnResize: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useCensusTableViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCensusTableDependencies).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusTableDependencies>>({
        beds: {},
        staff: {
          nursesDayShift: [],
          nursesNightShift: [],
          tensDayShift: [],
          tensNightShift: [],
          activeExtraBeds: ['E1'],
        },
        overrides: {},
        resetDay: vi.fn(),
        updatePatient: vi.fn(),
        handleRowAction: vi.fn(),
        confirm: vi.fn(),
        warning: vi.fn(),
        role: 'admin',
        config: getDefaultConfig(),
        isEditMode: true,
        updateColumnWidth: vi.fn(),
        diagnosisMode: 'free',
        toggleDiagnosisMode: vi.fn(),
      })
    );

    vi.mocked(useEmptyBedActivation).mockReturnValue(
      asHookValue<ReturnType<typeof useEmptyBedActivation>>({
        activateEmptyBed: vi.fn(),
      })
    );

    vi.mocked(useCensusTableModel).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusTableModel>>({
        canDeleteRecord: true,
        resetDayDeniedMessage: '',
        occupiedRows: [],
        emptyBeds: [],
        bedTypes: {},
        totalWidth: 1000,
        handleClearAll: vi.fn(),
      })
    );

    vi.mocked(useCensusColumnResize).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusColumnResize>>({
        handleColumnResize: vi.fn(),
      })
    );
  });

  it('delegates model creation using dependency hook values', () => {
    renderHook(() => useCensusTableViewModel({ currentDateString: '2026-02-15' }));

    expect(useCensusTableModel).toHaveBeenCalledWith({
      currentDateString: '2026-02-15',
      role: 'admin',
      beds: {},
      activeExtraBeds: ['E1'],
      overrides: {},
      columns: getDefaultConfig().columns,
      resetDay: expect.any(Function),
      confirm: expect.any(Function),
      warning: expect.any(Function),
    });
  });

  it('falls back to empty extra beds when staff payload is missing', () => {
    vi.mocked(useCensusTableDependencies).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusTableDependencies>>({
        beds: {},
        staff: undefined,
        overrides: {},
        resetDay: vi.fn(),
        updatePatient: vi.fn(),
        handleRowAction: vi.fn(),
        confirm: vi.fn(),
        warning: vi.fn(),
        role: 'admin',
        config: getDefaultConfig(),
        isEditMode: false,
        updateColumnWidth: vi.fn(),
        diagnosisMode: 'cie10',
        toggleDiagnosisMode: vi.fn(),
      })
    );

    renderHook(() => useCensusTableViewModel({ currentDateString: '2026-02-15' }));

    expect(useCensusTableModel).toHaveBeenCalledWith(
      expect.objectContaining({ activeExtraBeds: [] })
    );
  });
});
