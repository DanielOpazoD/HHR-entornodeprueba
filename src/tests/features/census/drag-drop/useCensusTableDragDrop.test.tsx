import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DragEvent } from 'react';
import { useCensusTableDragDrop } from '@/features/census/drag-drop/useCensusTableDragDrop';
import { DRAG_DATA_FORMAT } from '@/features/census/drag-drop/dragDropController';

describe('useCensusTableDragDrop patient handlers', () => {
  it('reuses each bed handler across hover renders while preserving its source bed', () => {
    const beds = { R1: { patientName: 'Paciente sintético' }, R2: { patientName: '' } };
    const { result, rerender } = renderHook(() => useCensusTableDragDrop(vi.fn(), beds));
    const dragR1 = result.current.patientHandlers.onDragStart('R1');
    const dragR2 = result.current.patientHandlers.onDragStart('R2');

    act(() => {
      result.current.emptyBedHandlers.onDragEnter('R2')({
        preventDefault: vi.fn(),
      } as unknown as DragEvent);
    });
    rerender();

    expect(result.current.state.dragOverBedId).toBe('R2');
    expect(result.current.patientHandlers.onDragStart('R1')).toBe(dragR1);
    expect(result.current.patientHandlers.onDragStart('R2')).toBe(dragR2);
    expect(dragR1).not.toBe(dragR2);

    const setData = vi.fn();
    act(() => {
      dragR1({ dataTransfer: { setData } } as unknown as DragEvent);
    });
    expect(setData).toHaveBeenCalledWith(DRAG_DATA_FORMAT, 'R1');
    expect(result.current.state.dragSourceBedId).toBe('R1');
  });
});
