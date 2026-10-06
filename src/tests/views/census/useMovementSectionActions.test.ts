import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMovementSectionActions } from '@/features/census/hooks/useMovementSectionActions';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';

const { confirm, notifyError } = vi.hoisted(() => ({ confirm: vi.fn(), notifyError: vi.fn() }));
vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({ confirm }),
  useNotification: () => ({ error: notifyError }),
}));
const makeParams = () => ({
  undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
  undoErrorTitle: 'undo error',
  onUndo: vi.fn(),
  deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
  deleteErrorTitle: 'delete error',
  onDelete: vi.fn(),
});
describe('useMovementSectionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirm.mockResolvedValue(true);
  });
  it.each(['undo', 'delete'] as const)(
    'confirms %s and runs the selected mutation with its id',
    async action => {
      const params = makeParams();
      const { result } = renderHook(() => useMovementSectionActions(params));
      await act(async () => {
        await (action === 'undo' ? result.current.handleUndo : result.current.handleDelete)(
          'movement-1'
        );
      });
      expect(confirm).toHaveBeenCalledWith(
        action === 'undo' ? params.undoDialog : params.deleteDialog
      );
      expect(action === 'undo' ? params.onUndo : params.onDelete).toHaveBeenCalledWith(
        'movement-1'
      );
      expect(action === 'undo' ? params.onDelete : params.onUndo).not.toHaveBeenCalled();
    }
  );
  it('does not mutate after a rejected confirmation', async () => {
    confirm.mockResolvedValue(false);
    const params = makeParams();
    const { result } = renderHook(() => useMovementSectionActions(params));
    await act(async () => {
      await result.current.handleUndo('movement-1');
      await result.current.handleDelete('movement-1');
    });
    expect(params.onUndo).not.toHaveBeenCalled();
    expect(params.onDelete).not.toHaveBeenCalled();
  });
  it('shares the in-flight guard between undo and delete and releases it after completion', async () => {
    let accept!: (value: boolean) => void;
    confirm.mockReturnValueOnce(
      new Promise<boolean>(resolve => {
        accept = resolve;
      })
    );
    const params = makeParams();
    const { result } = renderHook(() => useMovementSectionActions(params));
    let undo!: Promise<void>;
    act(() => {
      undo = result.current.handleUndo('movement-1');
    });
    await act(async () => {
      await result.current.handleDelete('movement-1');
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(params.onDelete).not.toHaveBeenCalled();
    await act(async () => {
      accept(true);
      await undo;
    });
    expect(params.onUndo).toHaveBeenCalledWith('movement-1');
    await act(async () => {
      await result.current.handleDelete('movement-2');
    });
    expect(params.onDelete).toHaveBeenCalledWith('movement-2');
  });
  it('reports a failed mutation with the action-specific error title', async () => {
    const params = makeParams();
    params.onDelete.mockRejectedValue(new Error('write rejected'));
    const { result } = renderHook(() => useMovementSectionActions(params));
    await act(async () => {
      await result.current.handleDelete('movement-1');
    });
    expect(notifyError).toHaveBeenCalledWith(
      'delete error',
      expect.stringContaining('write rejected')
    );
  });
});
