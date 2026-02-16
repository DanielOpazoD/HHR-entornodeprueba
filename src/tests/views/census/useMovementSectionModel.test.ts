import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';
import { useMovementSectionModel } from '@/features/census/hooks/useMovementSectionModel';
import { useMovementSectionActions } from '@/features/census/hooks/useMovementSectionActions';

vi.mock('@/features/census/hooks/useMovementSectionActions', () => ({
  useMovementSectionActions: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useMovementSectionModel', () => {
  const handleUndo = vi.fn();
  const handleDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMovementSectionActions).mockReturnValue(
      asHookValue<ReturnType<typeof useMovementSectionActions>>({
        handleUndo,
        handleDelete,
      })
    );
  });

  it('returns non-renderable state when source items are null', () => {
    const onUndo = vi.fn();
    const onDelete = vi.fn();

    const { result } = renderHook(() =>
      useMovementSectionModel({
        items: null,
        undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
        undoErrorTitle: 'undo error',
        onUndo,
        deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
        deleteErrorTitle: 'delete error',
        onDelete,
      })
    );

    expect(result.current).toEqual({
      isRenderable: false,
      isEmpty: true,
      items: [],
      handleUndo,
      handleDelete,
    });
    expect(useMovementSectionActions).toHaveBeenCalledWith({
      undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
      undoErrorTitle: 'undo error',
      onUndo,
      deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
      deleteErrorTitle: 'delete error',
      onDelete,
    });
  });

  it('returns empty section state for an empty array and populated state for data', () => {
    const { result, rerender } = renderHook(
      ({ items }) =>
        useMovementSectionModel({
          items,
          undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
          undoErrorTitle: 'undo error',
          onUndo: vi.fn(),
          deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
          deleteErrorTitle: 'delete error',
          onDelete: vi.fn(),
        }),
      {
        initialProps: {
          items: [] as Array<{ id: string }>,
        },
      }
    );

    expect(result.current.isRenderable).toBe(true);
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.items).toEqual([]);

    rerender({
      items: [{ id: 'x-1' }],
    });

    expect(result.current.isRenderable).toBe(true);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.items).toEqual([{ id: 'x-1' }]);
  });
});
