import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECEIVING_CENTER,
  EVACUATION_METHOD_AEROCARDAL,
  EVACUATION_METHOD_COMMERCIAL,
} from '@/constants';
import { useTransferModalForm } from '@/features/census/hooks/useTransferModalForm';

describe('useTransferModalForm', () => {
  it('applies evacuation side effects and clears dependent fields', () => {
    const onUpdate = vi.fn();

    const { result } = renderHook(() =>
      useTransferModalForm({
        isOpen: true,
        recordDate: '2024-12-11',
        includeMovementDate: false,
        initialTime: '11:00',
        evacuationMethod: EVACUATION_METHOD_AEROCARDAL,
        evacuationMethodOther: 'tmp',
        receivingCenter: DEFAULT_RECEIVING_CENTER,
        receivingCenterOther: '',
        transferEscort: 'TENS',
        onUpdate,
        onConfirm: vi.fn(),
        resolveDefaultTime: () => '09:00',
      })
    );

    act(() => {
      result.current.handleEvacuationChange(EVACUATION_METHOD_COMMERCIAL);
    });

    expect(onUpdate).toHaveBeenCalledWith('evacuationMethod', EVACUATION_METHOD_COMMERCIAL);
    expect(onUpdate).toHaveBeenCalledWith('transferEscort', 'Enfermera');
    expect(onUpdate).toHaveBeenCalledWith('evacuationMethodOther', '');
  });

  it('blocks submit with validation errors and submits when valid', () => {
    const onConfirm = vi.fn();

    const { result, rerender } = renderHook(
      ({ transferEscort }) =>
        useTransferModalForm({
          isOpen: true,
          recordDate: '2024-12-11',
          includeMovementDate: false,
          initialTime: '11:00',
          evacuationMethod: EVACUATION_METHOD_COMMERCIAL,
          evacuationMethodOther: '',
          receivingCenter: DEFAULT_RECEIVING_CENTER,
          receivingCenterOther: '',
          transferEscort,
          onUpdate: vi.fn(),
          onConfirm,
          resolveDefaultTime: () => '09:00',
        }),
      {
        initialProps: { transferEscort: '' },
      }
    );

    act(() => {
      result.current.submit();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.errors.escort).toBeTruthy();

    rerender({ transferEscort: 'Enfermera' });

    act(() => {
      result.current.submit();
    });

    expect(onConfirm).toHaveBeenCalledWith({ time: '11:00', movementDate: undefined });
  });
});
