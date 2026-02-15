import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientInputCellsModel } from '@/features/census/components/patient-row/usePatientInputCellsModel';
import { useDailyRecordStability } from '@/context/DailyRecordContext';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStability: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('usePatientInputCellsModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives lock state from stability rules and readOnly', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordStability>>({
        canEditField: () => true,
      })
    );

    const { result, rerender } = renderHook(
      ({ readOnly }) =>
        usePatientInputCellsModel({
          data: DataFactory.createMockPatient('R1'),
          readOnly,
          textChange: () => vi.fn(),
        }),
      { initialProps: { readOnly: false } }
    );

    expect(result.current.isLocked).toBe(false);

    rerender({ readOnly: true });
    expect(result.current.isLocked).toBe(true);
  });

  it('adapts debounced text input to event-based handler', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordStability>>({
        canEditField: () => true,
      })
    );
    const fieldHandler = vi.fn();
    const textChange = vi.fn().mockReturnValue(fieldHandler);

    const { result } = renderHook(() =>
      usePatientInputCellsModel({
        data: DataFactory.createMockPatient('R1'),
        readOnly: false,
        textChange,
      })
    );

    act(() => {
      result.current.handleDebouncedText('patientName')('Paciente X');
    });

    expect(textChange).toHaveBeenCalledWith('patientName');
    expect(fieldHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ value: 'Paciente X' }),
      })
    );
  });
});
