import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMoveCopyModalState } from '@/features/census/hooks/useMoveCopyModalState';

describe('useMoveCopyModalState', () => {
  it('initializes selected date from current record date when modal opens', async () => {
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.selectedDate).toBe('2026-02-14');
  });

  it('resets target bed only when date actually changes', async () => {
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

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.handleDateSelect('2026-02-14');
    });
    expect(onSetTarget).not.toHaveBeenCalled();

    act(() => {
      result.current.handleDateSelect('2026-02-15');
    });
    expect(onSetTarget).toHaveBeenCalledWith('');
  });

  it('confirms move without date payload and copy with selected date', async () => {
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

    await act(async () => {
      await Promise.resolve();
    });

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

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      copyResult.current.handleDateSelect('2026-02-15');
    });
    act(() => {
      copyResult.current.handleConfirm();
    });
    expect(copyConfirm).toHaveBeenCalledWith('2026-02-15');
  });
});
