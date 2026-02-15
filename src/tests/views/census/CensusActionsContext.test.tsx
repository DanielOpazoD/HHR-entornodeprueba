import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import {
  CensusActionsProvider,
  useCensusActionCommands,
  useCensusActions,
  useCensusActionState,
} from '@/features/census/components/CensusActionsContext';
import type { DailyRecord } from '@/types';
import { DataFactory } from '@/tests/factories/DataFactory';

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

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CensusActionsProvider>{children}</CensusActionsProvider>
);

const buildCopyActionState = () => ({
  type: 'copy' as const,
  sourceBedId: 'R1',
  targetBedId: 'R2',
});

const createDeferredVoid = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(res => {
    resolve = () => res();
  });

  return { promise, resolve };
};

describe('CensusActionsContext hooks', () => {
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

    mockedUseDailyRecordActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
      copyPatientToDate: vi.fn().mockResolvedValue(undefined),
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

  it('uses copy-specific notification title when copy-to-date execution fails', async () => {
    const record = DataFactory.createMockDailyRecord('2026-02-13', {
      beds: {
        R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
        R2: DataFactory.createMockPatient('R2', { patientName: '' }),
      },
    });

    mockedUseDailyRecordData.mockReturnValue({
      record,
      stabilityRules: {
        isDateLocked: false,
        isDayShiftLocked: false,
        isNightShiftLocked: false,
        canEditField: () => true,
        canPerformActions: true,
      },
    });

    mockedUseDailyRecordActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
      copyPatientToDate: vi.fn().mockRejectedValue(new Error('copy failed')),
    });

    const { result } = renderHook(
      () => ({
        state: useCensusActionState(),
        commands: useCensusActionCommands(),
      }),
      { wrapper }
    );

    act(() => {
      result.current.state.setActionState({
        type: 'copy',
        sourceBedId: 'R1',
        targetBedId: 'R2',
      });
    });

    act(() => {
      result.current.commands.executeMoveOrCopy('2026-02-14');
    });

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('No se pudo copiar', expect.any(String));
    });
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

  it('ignores concurrent move/copy execution while one request is pending', async () => {
    const deferredCopy = createDeferredVoid();
    const copyPatientToDate = vi.fn().mockImplementation(() => deferredCopy.promise);
    const record = DataFactory.createMockDailyRecord('2026-02-13', {
      beds: {
        R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
        R2: DataFactory.createMockPatient('R2', { patientName: '' }),
      },
    });

    mockedUseDailyRecordData.mockReturnValue({
      record,
      stabilityRules: {
        isDateLocked: false,
        isDayShiftLocked: false,
        isNightShiftLocked: false,
        canEditField: () => true,
        canPerformActions: true,
      },
    });

    mockedUseDailyRecordActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
      copyPatientToDate,
    });

    const { result } = renderHook(
      () => ({
        state: useCensusActionState(),
        commands: useCensusActionCommands(),
      }),
      { wrapper }
    );

    act(() => {
      result.current.state.setActionState(buildCopyActionState());
    });

    act(() => {
      result.current.commands.executeMoveOrCopy('2026-02-14');
      result.current.commands.executeMoveOrCopy('2026-02-14');
    });

    expect(copyPatientToDate).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferredCopy.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.actionState.type).toBeNull();
    });

    act(() => {
      result.current.state.setActionState(buildCopyActionState());
    });

    await waitFor(() => {
      expect(result.current.state.actionState.type).toBe('copy');
    });

    act(() => {
      result.current.commands.executeMoveOrCopy('2026-02-14');
    });

    await waitFor(() => {
      expect(copyPatientToDate).toHaveBeenCalledTimes(2);
    });
  });

  it('shows fallback notification when a row action throws unexpectedly', async () => {
    mockedUseDailyRecordActions.mockReturnValue({
      clearPatient: vi.fn(() => {
        throw new Error('unexpected');
      }),
      moveOrCopyPatient: vi.fn(),
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
      copyPatientToDate: vi.fn().mockResolvedValue(undefined),
    });

    mockedUseConfirmDialog.mockReturnValue({
      confirm: vi.fn().mockResolvedValue(true),
    });

    const { result } = renderHook(() => useCensusActionCommands(), { wrapper });

    await act(async () => {
      await result.current.handleRowAction(
        'clear',
        'R1',
        DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' })
      );
    });

    expect(mockNotifyError).toHaveBeenCalledWith(
      'No se pudo ejecutar la acción',
      'Ocurrió un error inesperado al procesar la acción del paciente.'
    );
  });
});
