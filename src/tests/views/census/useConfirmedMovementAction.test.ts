import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfirmedMovementAction } from '@/features/census/hooks/useConfirmedMovementAction';

describe('useConfirmedMovementAction', () => {
  it('runs action after accepted confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const notifyError = vi.fn();
    const run = vi.fn();

    const { result } = renderHook(() =>
      useConfirmedMovementAction({
        confirm,
        notifyError,
      })
    );

    await act(async () => {
      await result.current({
        dialog: {
          title: 'Test',
          message: 'Confirm?',
          confirmText: 'OK',
          cancelText: 'Cancel',
          variant: 'warning',
        },
        run,
        errorTitle: 'Error',
      });
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('reports explicit error when confirm rejects', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('dialog crashed'));
    const notifyError = vi.fn();
    const run = vi.fn();

    const { result } = renderHook(() =>
      useConfirmedMovementAction({
        confirm,
        notifyError,
      })
    );

    await act(async () => {
      await result.current({
        dialog: {
          message: 'Confirm?',
        },
        run,
        errorTitle: 'No se pudo confirmar',
      });
    });

    expect(run).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith(
      'No se pudo confirmar',
      expect.stringContaining('dialog crashed')
    );
  });

  it('reports explicit error when confirmed action fails asynchronously', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const notifyError = vi.fn();
    const run = vi.fn().mockRejectedValue(new Error('mutation crashed'));

    const { result } = renderHook(() =>
      useConfirmedMovementAction({
        confirm,
        notifyError,
      })
    );

    await act(async () => {
      await result.current({
        dialog: {
          message: 'Confirm?',
        },
        run,
        errorTitle: 'No se pudo ejecutar',
      });
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      'No se pudo ejecutar',
      expect.stringContaining('mutation crashed')
    );
  });

  it('ignores re-entrant calls while one confirmation is in flight', async () => {
    let resolveConfirm: ((value: boolean) => void) | null = null;
    const confirm = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          resolveConfirm = resolve;
        })
    );
    const notifyError = vi.fn();
    const run = vi.fn();

    const { result } = renderHook(() =>
      useConfirmedMovementAction({
        confirm,
        notifyError,
      })
    );

    await act(async () => {
      void result.current({
        dialog: { message: 'A' },
        run,
        errorTitle: 'E',
      });
      void result.current({
        dialog: { message: 'B' },
        run,
        errorTitle: 'E',
      });
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    await act(async () => {
      resolveConfirm?.(true);
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
  });
});
