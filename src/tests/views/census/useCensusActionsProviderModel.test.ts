import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
} from '@/constants/clinicalMovementConstants';
import { useCensusActionsProviderModel } from '@/features/census/hooks/useCensusActionsProviderModel';

const mockedUseDailyRecordData = vi.fn();
const mockedUseDailyRecordBedActions = vi.fn();
const mockedUseDailyRecordMovementActions = vi.fn();
const mockedUseConfirmDialog = vi.fn();
const mockedUseNotification = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mockedUseDailyRecordData(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: () => mockedUseDailyRecordBedActions(),
  useDailyRecordMovementActions: () => mockedUseDailyRecordMovementActions(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => mockedUseConfirmDialog(),
  useNotification: () => mockedUseNotification(),
}));

describe('useCensusActionsProviderModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseDailyRecordData.mockReturnValue({
      record: null,
      stabilityRules: {
        isDateLocked: false,
        isDayShiftLocked: false,
        isNightShiftLocked: false,
        canEditField: () => true,
        canPerformActions: true,
      },
    });

    mockedUseConfirmDialog.mockReturnValue({
      confirm: vi.fn().mockResolvedValue(true),
    });

    mockedUseNotification.mockReturnValue({
      error: vi.fn(),
      warning: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    });
  });

  it('uses injected clock provider for default discharge/transfer time payloads', async () => {
    const addDischarge = vi.fn();
    const addTransfer = vi.fn();

    mockedUseDailyRecordBedActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      copyPatientToDate: vi.fn().mockResolvedValue(undefined),
    });
    mockedUseDailyRecordMovementActions.mockReturnValue({
      addDischarge,
      updateDischarge: vi.fn(),
      addTransfer,
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
    });

    const { result } = renderHook(() =>
      useCensusActionsProviderModel({
        getCurrentTime: () => '07:45',
      })
    );

    act(() => {
      result.current.stateValue.setDischargeState(prev => ({
        ...prev,
        bedId: 'R1',
        isOpen: true,
        time: undefined,
      }));
    });

    await act(async () => {
      result.current.commandsValue.executeDischarge();
    });

    expect(addDischarge).toHaveBeenCalledWith('R1', { status: 'Vivo', time: '07:45' });

    act(() => {
      result.current.stateValue.setTransferState(prev => ({
        ...prev,
        bedId: 'R2',
        isOpen: true,
        time: undefined,
      }));
    });

    await act(async () => {
      result.current.commandsValue.executeTransfer();
    });

    expect(addTransfer).toHaveBeenCalledWith('R2', {
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
      time: '07:45',
    });
  });
});
