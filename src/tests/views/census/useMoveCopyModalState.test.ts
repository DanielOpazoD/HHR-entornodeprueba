import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMoveCopyModalState } from '@/features/census/hooks/useMoveCopyModalState';

describe('useMoveCopyModalState', () => {
  it('initializes selected date from current record date when modal opens', () => {
    const onSetTarget = vi.fn();
    const onConfirm = vi.fn();

    const { result } = renderHook(() =>
      useMoveCopyModalState({
        isOpen: true,
        type: 'copy',
        currentRecordDate: '2026-02-14',
        targetBedId: null,
        onSetTarget,
        onConfirm,
      })
    );

    expect(result.current.selectedDate).toBe('2026-02-14');
  });

  it('resets target bed only when date actually changes', () => {
    const onSetTarget = vi.fn();

    const { result } = renderHook(() =>
      useMoveCopyModalState({
        isOpen: true,
        type: 'copy',
        currentRecordDate: '2026-02-14',
        targetBedId: null,
        onSetTarget,
        onConfirm: vi.fn(),
      })
    );

    act(() => {
      result.current.handleDateSelect('2026-02-14');
    });
    expect(onSetTarget).not.toHaveBeenCalled();

    act(() => {
      result.current.handleDateSelect('2026-02-15');
    });
    expect(onSetTarget).toHaveBeenCalledWith('');
  });

  it('confirms move without date payload and copy with selected date', () => {
    const moveConfirm = vi.fn();
    const copyConfirm = vi.fn();

    const { result: moveResult } = renderHook(() =>
      useMoveCopyModalState({
        isOpen: true,
        type: 'move',
        currentRecordDate: '2026-02-14',
        targetBedId: 'R2',
        onSetTarget: vi.fn(),
        onConfirm: moveConfirm,
      })
    );

    act(() => {
      moveResult.current.handleConfirm();
    });
    expect(moveConfirm).toHaveBeenCalledWith(undefined);

    const { result: copyResult } = renderHook(() =>
      useMoveCopyModalState({
        isOpen: true,
        type: 'copy',
        currentRecordDate: '2026-02-14',
        targetBedId: 'R2',
        onSetTarget: vi.fn(),
        onConfirm: copyConfirm,
      })
    );

    act(() => {
      copyResult.current.handleDateSelect('2026-02-15');
    });
    act(() => {
      copyResult.current.handleConfirm();
    });
    expect(copyConfirm).toHaveBeenCalledWith('2026-02-15');
  });
});
