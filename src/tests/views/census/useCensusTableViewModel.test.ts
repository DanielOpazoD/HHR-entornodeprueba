import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusTableViewModel } from '@/features/census/hooks/useCensusTableViewModel';

const mockedUseDailyRecordBeds = vi.fn();
const mockedUseDailyRecordStaff = vi.fn();
const mockedUseDailyRecordOverrides = vi.fn();
const mockedUseDailyRecordActions = vi.fn();
const mockedUseCensusActionCommands = vi.fn();
const mockedUseConfirmDialog = vi.fn();
const mockedUseNotification = vi.fn();
const mockedUseAuth = vi.fn();
const mockedUseTableConfig = vi.fn();
const mockedUseEmptyBedActivation = vi.fn();
const mockedUseDiagnosisMode = vi.fn();
const mockedUseCensusTableModel = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => mockedUseDailyRecordBeds(),
  useDailyRecordStaff: () => mockedUseDailyRecordStaff(),
  useDailyRecordOverrides: () => mockedUseDailyRecordOverrides(),
  useDailyRecordActions: () => mockedUseDailyRecordActions(),
}));

vi.mock('@/features/census/components/CensusActionsContext', () => ({
  useCensusActionCommands: () => mockedUseCensusActionCommands(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => mockedUseConfirmDialog(),
  useNotification: () => mockedUseNotification(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockedUseAuth(),
}));

vi.mock('@/context/TableConfigContext', () => ({
  useTableConfig: () => mockedUseTableConfig(),
}));

vi.mock('@/features/census/components/useEmptyBedActivation', () => ({
  useEmptyBedActivation: (...args: unknown[]) => mockedUseEmptyBedActivation(...args),
}));

vi.mock('@/features/census/hooks/useDiagnosisMode', () => ({
  useDiagnosisMode: () => mockedUseDiagnosisMode(),
}));

vi.mock('@/features/census/hooks/useCensusTableModel', () => ({
  useCensusTableModel: (...args: unknown[]) => mockedUseCensusTableModel(...args),
}));

describe('useCensusTableViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseDailyRecordBeds.mockReturnValue({});
    mockedUseDailyRecordStaff.mockReturnValue({ activeExtraBeds: ['E1'] });
    mockedUseDailyRecordOverrides.mockReturnValue({});
    mockedUseDailyRecordActions.mockReturnValue({
      resetDay: vi.fn(),
      updatePatient: vi.fn(),
    });
    mockedUseCensusActionCommands.mockReturnValue({
      handleRowAction: vi.fn(),
    });
    mockedUseConfirmDialog.mockReturnValue({ confirm: vi.fn() });
    mockedUseNotification.mockReturnValue({ warning: vi.fn() });
    mockedUseAuth.mockReturnValue({ role: 'admin' });
    mockedUseTableConfig.mockReturnValue({
      config: { columns: { actions: 50, diagnosis: 200, bed: 80 } },
      isEditMode: true,
      updateColumnWidth: vi.fn(),
    });
    mockedUseEmptyBedActivation.mockReturnValue({ activateEmptyBed: vi.fn() });
    mockedUseDiagnosisMode.mockReturnValue({
      diagnosisMode: 'free',
      toggleDiagnosisMode: vi.fn(),
    });
    mockedUseCensusTableModel.mockReturnValue({
      canDeleteRecord: true,
      resetDayDeniedMessage: '',
      occupiedRows: [],
      emptyBeds: [],
      bedTypes: {},
      totalWidth: 1200,
      handleClearAll: vi.fn(),
    });
  });

  it('delegates data to useCensusTableModel with context-driven params', () => {
    renderHook(() => useCensusTableViewModel({ currentDateString: '2026-02-15' }));

    expect(mockedUseCensusTableModel).toHaveBeenCalledWith({
      currentDateString: '2026-02-15',
      role: 'admin',
      beds: {},
      activeExtraBeds: ['E1'],
      overrides: {},
      columns: { actions: 50, diagnosis: 200, bed: 80 },
      resetDay: expect.any(Function),
      confirm: expect.any(Function),
      warning: expect.any(Function),
    });
  });

  it('exposes column resize callback wired to updateColumnWidth', () => {
    const updateColumnWidth = vi.fn();
    mockedUseTableConfig.mockReturnValue({
      config: { columns: { actions: 50, diagnosis: 200, bed: 80 } },
      isEditMode: false,
      updateColumnWidth,
    });

    const { result } = renderHook(() =>
      useCensusTableViewModel({ currentDateString: '2026-02-15' })
    );

    result.current.handleColumnResize('bed')(130);
    expect(updateColumnWidth).toHaveBeenCalledWith('bed', 130);
  });
});
