import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMovementSectionConfirmHandlers } from '@/features/census/hooks/useMovementSectionConfirmHandlers';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';

describe('useMovementSectionConfirmHandlers', () => {
  it('runs undo with provided dialog and error title', async () => {
    const runConfirmedAction = vi.fn().mockResolvedValue(undefined);
    const onUndo = vi.fn();

    const { result } = renderHook(() =>
      useMovementSectionConfirmHandlers({
        runConfirmedAction,
        undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
        undoErrorTitle: 'undo error',
        onUndo,
        deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
        deleteErrorTitle: 'delete error',
        onDelete: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleUndo('d1');
    });

    expect(runConfirmedAction).toHaveBeenCalledWith({
      dialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
      errorTitle: 'undo error',
      run: expect.any(Function),
    });

    const run = runConfirmedAction.mock.calls[0][0].run as () => void;
    run();
    expect(onUndo).toHaveBeenCalledWith('d1');
  });

  it('runs delete with provided dialog and error title', async () => {
    const runConfirmedAction = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn();

    const { result } = renderHook(() =>
      useMovementSectionConfirmHandlers({
        runConfirmedAction,
        undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
        undoErrorTitle: 'undo error',
        onUndo: vi.fn(),
        deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
        deleteErrorTitle: 'delete error',
        onDelete,
      })
    );

    await act(async () => {
      await result.current.handleDelete('d2');
    });

    expect(runConfirmedAction).toHaveBeenCalledWith({
      dialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
      errorTitle: 'delete error',
      run: expect.any(Function),
    });

    const run = runConfirmedAction.mock.calls[0][0].run as () => void;
    run();
    expect(onDelete).toHaveBeenCalledWith('d2');
  });
});
