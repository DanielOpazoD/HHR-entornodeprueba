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

it('refreshes drop data when occupants change and moves only after confirmation', () => {
  const move = vi.fn();
  const { result, rerender } = renderHook(
    ({ name }) =>
      useCensusTableDragDrop(move, { R1: { patientName: name }, R2: { patientName: '' } }),
    { initialProps: { name: 'Anterior' } }
  );
  const enter = result.current.emptyBedHandlers.onDragEnter('R2');
  const over = result.current.emptyBedHandlers.onDragOver('R2');
  const oldDrop = result.current.emptyBedHandlers.onDrop('R2');
  act(() => enter({ preventDefault: vi.fn() } as unknown as DragEvent));
  expect(result.current.emptyBedHandlers.onDragEnter('R2')).toBe(enter);
  expect(result.current.emptyBedHandlers.onDragOver('R2')).toBe(over);
  rerender({ name: 'Actual' });
  expect(result.current.emptyBedHandlers.onDrop('R2')).not.toBe(oldDrop);
  const event = {
    preventDefault: vi.fn(),
    dataTransfer: { getData: () => 'R1' },
  } as unknown as DragEvent;
  act(() => result.current.emptyBedHandlers.onDrop('R2')(event));
  expect(result.current.state.pendingMove).toEqual({
    sourceBedId: 'R1',
    targetBedId: 'R2',
    patientName: 'Actual',
  });
  expect(move).not.toHaveBeenCalled();
  act(() => result.current.confirmationHandlers.onCancel());
  expect(move).not.toHaveBeenCalled();
  expect(result.current.state.pendingMove).toBeNull();
  act(() => result.current.emptyBedHandlers.onDrop('R2')(event));
  act(() => result.current.confirmationHandlers.onConfirm());
  expect(move).toHaveBeenCalledExactlyOnceWith('R1', 'R2');
});
