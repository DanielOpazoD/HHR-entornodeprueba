import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBedManagerModalModel } from '@/features/census/hooks/useBedManagerModalModel';

describe('useBedManagerModalModel', () => {
  it('handles block flow with validation and success path', () => {
    const toggleBlockBed = vi.fn();
    const updateBlockedReason = vi.fn();
    const { result } = renderHook(() =>
      useBedManagerModalModel({ toggleBlockBed, updateBlockedReason })
    );

    act(() => {
      result.current.handleBedClick({ bedId: 'R1', isBlocked: false });
    });

    expect(result.current.blockingBedId).toBe('R1');
    expect(result.current.isBlockingDialogOpen).toBe(true);

    act(() => {
      result.current.confirmBlock();
    });

    expect(toggleBlockBed).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();

    act(() => {
      result.current.handleReasonChange('Mantención');
    });
    act(() => {
      result.current.confirmBlock();
    });

    expect(toggleBlockBed).toHaveBeenCalledWith('R1', 'Mantención');
    expect(result.current.blockingBedId).toBeNull();
    expect(result.current.reason).toBe('');
  });

  it('handles edit/save/unblock flow for blocked beds', () => {
    const toggleBlockBed = vi.fn();
    const updateBlockedReason = vi.fn();
    const { result } = renderHook(() =>
      useBedManagerModalModel({ toggleBlockBed, updateBlockedReason })
    );

    act(() => {
      result.current.handleBedClick({
        bedId: 'R2',
        isBlocked: true,
        blockedReason: 'Previo',
      });
    });

    expect(result.current.editingBedId).toBe('R2');
    expect(result.current.reason).toBe('Previo');
    expect(result.current.isAnyDialogOpen).toBe(true);

    act(() => {
      result.current.handleReasonChange('Nuevo motivo');
    });
    act(() => {
      result.current.saveReason();
    });

    expect(updateBlockedReason).toHaveBeenCalledWith('R2', 'Nuevo motivo');
    expect(result.current.editingBedId).toBeNull();

    act(() => {
      result.current.handleBedClick({ bedId: 'R3', isBlocked: true, blockedReason: 'Bloqueada' });
    });
    act(() => {
      result.current.unblockBed();
    });

    expect(toggleBlockBed).toHaveBeenCalledWith('R3');
    expect(result.current.editingBedId).toBeNull();
  });
});
