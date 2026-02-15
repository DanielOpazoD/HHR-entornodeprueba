import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusColumnResize } from '@/features/census/hooks/useCensusColumnResize';

describe('useCensusColumnResize', () => {
  it('forwards resize events to updateColumnWidth', () => {
    const updateColumnWidth = vi.fn();
    const { result } = renderHook(() => useCensusColumnResize({ updateColumnWidth }));

    act(() => {
      result.current.handleColumnResize('bed')(144);
      result.current.handleColumnResize('diagnosis')(220);
    });

    expect(updateColumnWidth).toHaveBeenNthCalledWith(1, 'bed', 144);
    expect(updateColumnWidth).toHaveBeenNthCalledWith(2, 'diagnosis', 220);
  });
});
