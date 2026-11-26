import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import {
  CensusActionsProvider,
  useCensusActionCommands,
  useCensusActionState,
} from '@/features/census/components/CensusActionsContext';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

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

describe('CensusActionsContext execution and feedback', () => {
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

    mockedUseDailyRecordBedActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
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

    mockedUseDailyRecordBedActions.mockReturnValue({
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
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
    mockedUseDailyRecordBedActions.mockReturnValue({
      clearPatient: vi.fn(() => {
        throw new Error('unexpected');
      }),
      moveOrCopyPatient: vi.fn(),
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

  it('ignores concurrent discharge execution while one request is in flight', async () => {
    const addDischarge = vi.fn();

    mockedUseDailyRecordMovementActions.mockReturnValue({
      addDischarge,
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
    });

    const { result } = renderHook(
      () => ({
        state: useCensusActionState(),
        commands: useCensusActionCommands(),
      }),
      { wrapper }
    );

    act(() => {
      result.current.state.setDischargeState(prev => ({
        ...prev,
        bedId: 'R1',
        isOpen: true,
        time: '10:00',
      }));
    });

    act(() => {
      result.current.commands.executeDischarge();
      result.current.commands.executeDischarge();
    });

    await waitFor(() => {
      expect(addDischarge).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores concurrent transfer execution while one request is in flight', () => {
    const addTransfer = vi.fn();

    mockedUseDailyRecordMovementActions.mockReturnValue({
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer,
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
    });

    const { result } = renderHook(
      () => ({
        state: useCensusActionState(),
        commands: useCensusActionCommands(),
      }),
      { wrapper }
    );

    act(() => {
      result.current.state.setTransferState(prev => ({
        ...prev,
        bedId: 'R1',
        isOpen: true,
        time: '10:00',
      }));
    });

    act(() => {
      result.current.commands.executeTransfer();
      result.current.commands.executeTransfer();
    });

    expect(addTransfer).toHaveBeenCalledTimes(1);
  });
});
