import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMovementSectionActions } from '@/features/census/hooks/useMovementSectionActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useConfirmedMovementAction } from '@/features/census/hooks/useConfirmedMovementAction';
import { useMovementSectionConfirmHandlers } from '@/features/census/hooks/useMovementSectionConfirmHandlers';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

vi.mock('@/features/census/hooks/useConfirmedMovementAction', () => ({
  useConfirmedMovementAction: vi.fn(),
}));

vi.mock('@/features/census/hooks/useMovementSectionConfirmHandlers', () => ({
  useMovementSectionConfirmHandlers: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useMovementSectionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useConfirmDialog).mockReturnValue(
      asHookValue<ReturnType<typeof useConfirmDialog>>({
        confirm: vi.fn(),
      })
    );
    vi.mocked(useNotification).mockReturnValue(
      asHookValue<ReturnType<typeof useNotification>>({
        error: vi.fn(),
      })
    );
    vi.mocked(useConfirmedMovementAction).mockReturnValue(
      asHookValue<ReturnType<typeof useConfirmedMovementAction>>(vi.fn())
    );
    vi.mocked(useMovementSectionConfirmHandlers).mockReturnValue(
      asHookValue<ReturnType<typeof useMovementSectionConfirmHandlers>>({
        handleUndo: vi.fn(),
        handleDelete: vi.fn(),
      })
    );
  });

  it('wires UI confirm/error dependencies into movement confirm handlers', () => {
    const onUndo = vi.fn();
    const onDelete = vi.fn();

    const { result } = renderHook(() =>
      useMovementSectionActions({
        undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
        undoErrorTitle: 'undo error',
        onUndo,
        deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
        deleteErrorTitle: 'delete error',
        onDelete,
      })
    );

    expect(useConfirmedMovementAction).toHaveBeenCalledWith({
      confirm: expect.any(Function),
      notifyError: expect.any(Function),
    });
    expect(useMovementSectionConfirmHandlers).toHaveBeenCalledWith({
      runConfirmedAction: expect.any(Function),
      undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
      undoErrorTitle: 'undo error',
      onUndo,
      deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
      deleteErrorTitle: 'delete error',
      onDelete,
    });
    expect(typeof result.current.handleUndo).toBe('function');
    expect(typeof result.current.handleDelete).toBe('function');
  });
});
