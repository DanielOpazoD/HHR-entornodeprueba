import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DISCHARGE_TYPE_OTHER } from '@/constants';
import { useDischargeModalForm } from '@/features/census/hooks/useDischargeModalForm';

describe('useDischargeModalForm', () => {
  it('resets form state when modal opens and validates required other detail', () => {
    const onConfirm = vi.fn();

    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useDischargeModalForm({
          isOpen,
          status: 'Vivo',
          recordDate: '2024-12-11',
          includeMovementDate: false,
          initialType: undefined,
          initialOtherDetails: undefined,
          initialTime: undefined,
          dischargeTarget: 'both',
          hasClinicalCrib: true,
          resolveDefaultTime: () => '09:30',
          onConfirm,
        }),
      {
        initialProps: { isOpen: false },
      }
    );

    act(() => {
      rerender({ isOpen: true });
    });

    expect(result.current.dischargeTime).toBe('09:30');

    act(() => {
      result.current.setDischargeType(DISCHARGE_TYPE_OTHER);
    });
    act(() => {
      result.current.submit();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.errors.other).toBeTruthy();
  });

  it('submits typed payload with local target when form is valid', () => {
    const onConfirm = vi.fn();

    const { result } = renderHook(() =>
      useDischargeModalForm({
        isOpen: true,
        status: 'Vivo',
        recordDate: '2024-12-11',
        includeMovementDate: false,
        initialType: 'Voluntaria',
        initialOtherDetails: '',
        initialTime: '10:00',
        dischargeTarget: 'both',
        hasClinicalCrib: true,
        resolveDefaultTime: () => '09:30',
        onConfirm,
      })
    );

    act(() => {
      result.current.setLocalTarget('mother');
    });
    act(() => {
      result.current.submit();
    });

    expect(onConfirm).toHaveBeenCalledWith({
      status: 'Vivo',
      type: 'Voluntaria',
      typeOther: undefined,
      time: '10:00',
      movementDate: undefined,
      dischargeTarget: 'mother',
    });
  });
});
