import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
} from '@/constants';
import { useCensusActionsProviderModel } from '@/features/census/hooks/useCensusActionsProviderModel';

const mockedUseDailyRecordData = vi.fn();
const mockedUseDailyRecordActions = vi.fn();
const mockedUseConfirmDialog = vi.fn();
const mockedUseNotification = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mockedUseDailyRecordData(),
  useDailyRecordActions: () => mockedUseDailyRecordActions(),
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

  it('uses injected clock provider for default discharge/transfer time payloads', () => {
    const addDischarge = vi.fn();
    const addTransfer = vi.fn();

    mockedUseDailyRecordActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      addDischarge,
      updateDischarge: vi.fn(),
      addTransfer,
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
      copyPatientToDate: vi.fn().mockResolvedValue(undefined),
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

    act(() => {
      result.current.commandsValue.executeDischarge();
    });

    expect(addDischarge).toHaveBeenCalledWith(
      'R1',
      'Vivo',
      undefined,
      undefined,
      undefined,
      '07:45',
      undefined
    );

    act(() => {
      result.current.stateValue.setTransferState(prev => ({
        ...prev,
        bedId: 'R2',
        isOpen: true,
        time: undefined,
      }));
    });

    act(() => {
      result.current.commandsValue.executeTransfer();
    });

    expect(addTransfer).toHaveBeenCalledWith(
      'R2',
      DEFAULT_EVACUATION_METHOD,
      DEFAULT_RECEIVING_CENTER,
      '',
      DEFAULT_TRANSFER_ESCORT,
      '07:45'
    );
  });
});
