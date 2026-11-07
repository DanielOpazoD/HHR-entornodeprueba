import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockWarn = vi.fn();
const mockReconcileBootstrapRuntime = vi.fn();

vi.mock('@/services/utils/loggerService', () => ({
  logger: {
    child: () => ({
      warn: (...args: unknown[]) => mockWarn(...args),
    }),
  },
}));

vi.mock('@/app-shell/bootstrap/bootstrapAppRuntime', () => ({
  reconcileBootstrapRuntime: (...args: unknown[]) => mockReconcileBootstrapRuntime(...args),
}));

import { VERSION_RELOAD_IDLE_MS, useVersionCheck } from '@/hooks/useVersionCheck';

describe('useVersionCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockReconcileBootstrapRuntime.mockResolvedValue({ status: 'continue', reason: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('runs bootstrap reconciliation once after mount', async () => {
    renderHook(() => useVersionCheck());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(1);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('re-checks on an interval during long-lived sessions', async () => {
    renderHook(() => useVersionCheck());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(2);
  });

  it('re-checks when the window regains focus', async () => {
    renderHook(() => useVersionCheck());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(2);
  });

  it('keeps one live subscription after StrictMode setup-cleanup-setup and cleans up on unmount', async () => {
    const view = renderHook(() => useVersionCheck(), { wrapper: StrictMode });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(3);
    view.unmount();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(3);
  });
});

describe('useVersionCheck while the census is in use', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockReconcileBootstrapRuntime.mockResolvedValue({ status: 'continue', reason: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('waits until nobody has used the tab for a while before checking for a new version', async () => {
    renderHook(() => useVersionCheck());
    await advance(1000);
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
    });
    await advance(5 * 60 * 1000);
    await advance(5 * 60 * 1000);
    // Ten minutes after mount the last key is still 9:59 old.
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(1);

    await advance(5 * 60 * 1000);
    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(2);
  });

  it('counts scrolling inside a panel as use, though it does not bubble', async () => {
    renderHook(() => useVersionCheck());
    await advance(1000);
    const panel = document.createElement('div');
    document.body.appendChild(panel);

    act(() => {
      panel.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    await advance(5 * 60 * 1000);

    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(1);
    panel.remove();
  });

  it('does not check on focus right after the person used the tab', async () => {
    renderHook(() => useVersionCheck());
    await advance(1000);

    act(() => {
      window.dispatchEvent(new MouseEvent('mousedown'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(1);
  });

  it('gives the new version to a person who comes back after being away', async () => {
    renderHook(() => useVersionCheck());
    await advance(1000);
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    await advance(VERSION_RELOAD_IDLE_MS + 30_000);
    const before = mockReconcileBootstrapRuntime.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockReconcileBootstrapRuntime).toHaveBeenCalledTimes(before + 1);
  });

  it('asks again right before reloading, after the version answer arrives', async () => {
    renderHook(() => useVersionCheck());
    await advance(1000);
    const [options] = mockReconcileBootstrapRuntime.mock.calls[0] as [
      { canReloadForNewVersion: () => boolean },
    ];
    expect(options.canReloadForNewVersion()).toBe(true);

    act(() => {
      window.dispatchEvent(new MouseEvent('mousedown'));
    });

    expect(options.canReloadForNewVersion()).toBe(false);
  });
});
