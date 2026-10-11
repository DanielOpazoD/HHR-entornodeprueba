import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';
import { useMovementSectionModel } from '@/features/census/hooks/useMovementSectionModel';
const { handleUndo, handleDelete } = vi.hoisted(() => ({
  handleUndo: vi.fn(),
  handleDelete: vi.fn(),
}));
vi.mock('@/features/census/hooks/useMovementSectionActions', () => ({
  useMovementSectionActions: () => ({ handleUndo, handleDelete }),
}));
const params = {
  undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
  undoErrorTitle: 'undo error',
  onUndo: vi.fn(),
  deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
  deleteErrorTitle: 'delete error',
  onDelete: vi.fn(),
};
describe('useMovementSectionModel', () => {
  it('does not render a null source', () => {
    const { result } = renderHook(() => useMovementSectionModel({ ...params, items: null }));
    expect(result.current).toEqual({
      isRenderable: false,
      isEmpty: true,
      items: [],
      handleUndo,
      handleDelete,
    });
  });
  it.each([undefined, []])('renders an empty section for %j', items => {
    const { result } = renderHook(() => useMovementSectionModel({ ...params, items }));
    expect(result.current).toEqual({
      isRenderable: true,
      isEmpty: true,
      items: [],
      handleUndo,
      handleDelete,
    });
  });
  it('publishes new items when the section changes', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useMovementSectionModel({ ...params, items }),
      { initialProps: { items: [] as Array<{ id: string }> } }
    );
    expect(result.current.isEmpty).toBe(true);
    rerender({ items: [{ id: 'movement-1' }] });
    expect(result.current.items).toEqual([{ id: 'movement-1' }]);
    expect(result.current.isEmpty).toBe(false);
  });
});
