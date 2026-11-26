import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import {
  CensusActionsProvider,
  useCensusActionCommands,
  useCensusActions,
  useCensusActionState,
} from '@/features/census/components/CensusActionsContext';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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
}));

vi.mock('@/features/census/context/CensusMovementActionsContext', () => ({
  useCensusMovementActions: () => mockedUseDailyRecordMovementActions(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => mockedUseConfirmDialog(),
  useNotification: () => mockedUseNotification(),
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CensusActionsProvider>{children}</CensusActionsProvider>
);

describe('CensusActionsContext state and contract', () => {
  const mockNotifyError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseDailyRecordData.mockReturnValue({
      record: null as DailyRecord | null,
      stabilityRules: {
        isDateLocked: false,
        isDayShiftLocked: false,
        isNightShiftLocked: false,
        canEditField: () => true,
        canPerformActions: true,
      },
    });

    mockedUseDailyRecordBedActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      copyPatientToDate: vi.fn().mockResolvedValue(undefined),
    });

    mockedUseDailyRecordMovementActions.mockReturnValue({
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
    });

    mockedUseConfirmDialog.mockReturnValue({
      confirm: vi.fn().mockResolvedValue(true),
    });

    mockedUseNotification.mockReturnValue({
      error: mockNotifyError,
      warning: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    });
  });

  it('throws outside provider', () => {
    expect(() => renderHook(() => useCensusActionState())).toThrow(
      'useCensusActionState must be used within a CensusActionsProvider'
    );
    expect(() => renderHook(() => useCensusActionCommands())).toThrow(
      'useCensusActionCommands must be used within a CensusActionsProvider'
    );
  });

  it('keeps commands reference stable on local state updates', () => {
    const { result } = renderHook(
      () => ({
        state: useCensusActionState(),
        commands: useCensusActionCommands(),
      }),
      { wrapper }
    );

    const initialCommandsRef = result.current.commands;

    act(() => {
      result.current.state.setActionState({
        type: 'move',
        sourceBedId: 'R1',
        targetBedId: 'R2',
      });
    });

    expect(result.current.state.actionState).toEqual({
      type: 'move',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
    expect(result.current.commands).toBe(initialCommandsRef);
  });

  it('exposes merged state and command contract through useCensusActions', () => {
    const { result } = renderHook(() => useCensusActions(), { wrapper });

    expect(result.current.actionState).toEqual({
      type: null,
      sourceBedId: null,
      targetBedId: null,
    });
    expect(typeof result.current.executeMoveOrCopy).toBe('function');
    expect(typeof result.current.handleRowAction).toBe('function');
    expect(typeof result.current.setTransferState).toBe('function');
  });

  it('uses contextual notification title for discharge validation errors', () => {
    const { result } = renderHook(() => useCensusActionCommands(), { wrapper });

    act(() => {
      result.current.executeDischarge({ status: 'Vivo', time: '2500' });
    });

    expect(mockNotifyError).toHaveBeenCalledWith('Datos de alta incompletos', expect.any(String));
  });

  it('uses transfer validation title when transfer input is invalid', () => {
    const { result } = renderHook(() => useCensusActionCommands(), { wrapper });

    act(() => {
      result.current.executeTransfer({ time: '25:00' });
    });

    expect(mockNotifyError).toHaveBeenCalledWith(
      'Datos de traslado incompletos',
      expect.any(String)
    );
  });
});
