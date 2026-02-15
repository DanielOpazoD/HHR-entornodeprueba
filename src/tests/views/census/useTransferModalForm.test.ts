import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECEIVING_CENTER,
  EVACUATION_METHOD_AEROCARDAL,
  EVACUATION_METHOD_COMMERCIAL,
} from '@/constants';
import { useTransferModalForm } from '@/features/census/hooks/useTransferModalForm';
import { MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR } from '@/features/census/controllers/censusMovementDatePresentationController';

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

  it('blocks submit with canonical dateTime error when movement is out of shift range', () => {
    const onConfirm = vi.fn();

    const { result } = renderHook(() =>
      useTransferModalForm({
        isOpen: true,
        recordDate: '2024-12-11',
        includeMovementDate: true,
        initialTime: '10:00',
        initialMovementDate: '2024-12-12',
        evacuationMethod: EVACUATION_METHOD_COMMERCIAL,
        evacuationMethodOther: '',
        receivingCenter: DEFAULT_RECEIVING_CENTER,
        receivingCenterOther: '',
        transferEscort: 'Enfermera',
        onUpdate: vi.fn(),
        onConfirm,
        resolveDefaultTime: () => '09:00',
      })
    );

    act(() => {
      result.current.submit();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.errors.dateTime).toBe(MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR);
  });

  it('falls back to default time when initial transfer time is invalid', () => {
    const { result } = renderHook(() =>
      useTransferModalForm({
        isOpen: true,
        recordDate: '2024-12-11',
        includeMovementDate: false,
        initialTime: '99:99',
        evacuationMethod: EVACUATION_METHOD_COMMERCIAL,
        evacuationMethodOther: '',
        receivingCenter: DEFAULT_RECEIVING_CENTER,
        receivingCenterOther: '',
        transferEscort: 'Enfermera',
        onUpdate: vi.fn(),
        onConfirm: vi.fn(),
        resolveDefaultTime: () => '09:00',
      })
    );

    expect(result.current.transferTime).toBe('09:00');
  });
});
