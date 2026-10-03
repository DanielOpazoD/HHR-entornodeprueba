import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSyslabAccess } from '@/features/laboratory/hooks/useSyslabAccess';
import {
  openSyslabLoginWindow,
  requestSyslabExtensionStatus,
} from '@/services/laboratory/syslabExtensionBridge';

vi.mock('@/services/laboratory/syslabExtensionBridge', () => ({
  requestSyslabExtensionStatus: vi.fn(),
  openSyslabLoginWindow: vi.fn(),
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('useSyslabAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestSyslabExtensionStatus).mockResolvedValue({
      bridgeAvailable: true,
      connected: false,
      loginRequired: true,
      message: 'Syslab requiere iniciar sesión.',
    });
    vi.mocked(openSyslabLoginWindow).mockResolvedValue({
      bridgeAvailable: true,
      opened: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens the extension form and follows the session until it is connected', async () => {
    const { result } = renderHook(() => useSyslabAccess(true));

    await waitFor(() => expect(result.current.state).toBe('login-required'));
    await act(async () => result.current.openLogin());

    expect(openSyslabLoginWindow).toHaveBeenCalledTimes(1);
    expect(result.current.isAwaitingLogin).toBe(true);
    expect(result.current.message).toContain('ventana de la extensión');

    vi.mocked(requestSyslabExtensionStatus).mockResolvedValue({
      bridgeAvailable: true,
      connected: true,
      loginRequired: false,
      message: 'Sesión de Syslab activa.',
    });
    await act(async () => result.current.refresh());

    expect(result.current.state).toBe('connected');
    expect(result.current.isAwaitingLogin).toBe(false);
  });

  it('stops following the session when the extension bridge becomes unavailable', async () => {
    const { result } = renderHook(() => useSyslabAccess(true));

    await waitFor(() => expect(result.current.state).toBe('login-required'));
    await act(async () => result.current.openLogin());
    expect(result.current.isAwaitingLogin).toBe(true);

    vi.mocked(requestSyslabExtensionStatus).mockResolvedValue({
      bridgeAvailable: false,
      connected: false,
      loginRequired: false,
      message: 'La extensión no está disponible.',
    });
    await act(async () => result.current.refresh());

    expect(result.current.state).toBe('unavailable');
    expect(result.current.isAwaitingLogin).toBe(false);
  });

  it('stops following a login attempt that can no longer continue', async () => {
    const { result } = renderHook(() => useSyslabAccess(true));

    await waitFor(() => expect(result.current.state).toBe('login-required'));
    await act(async () => result.current.openLogin());

    vi.mocked(requestSyslabExtensionStatus).mockResolvedValue({
      bridgeAvailable: true,
      connected: false,
      loginRequired: false,
      message: 'Syslab no está disponible.',
    });
    await act(async () => result.current.refresh());

    expect(result.current.state).toBe('unavailable');
    expect(result.current.isAwaitingLogin).toBe(false);
  });
  it('coalesces manual refresh and polling while a status request is pending', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSyslabAccess(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.openLogin();
    });
    const pending = deferred<Awaited<ReturnType<typeof requestSyslabExtensionStatus>>>();
    vi.mocked(requestSyslabExtensionStatus).mockReturnValueOnce(pending.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    act(() => {
      void result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(requestSyslabExtensionStatus).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending.resolve({
        bridgeAvailable: true,
        connected: true,
        loginRequired: false,
        message: 'Sesión vigente',
      });
    });
    expect(result.current.state).toBe('connected');
    expect(result.current.isAwaitingLogin).toBe(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(requestSyslabExtensionStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores an old status after the panel is closed and reopened', async () => {
    vi.useFakeTimers();
    const pending = deferred<Awaited<ReturnType<typeof requestSyslabExtensionStatus>>>();
    vi.mocked(requestSyslabExtensionStatus).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ open }) => useSyslabAccess(open), {
      initialProps: { open: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ open: false });
    rerender({ open: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe('login-required');
    await act(async () => {
      pending.resolve({
        bridgeAvailable: true,
        connected: true,
        loginRequired: false,
        message: 'Sesión antigua',
      });
    });
    expect(result.current.state).toBe('login-required');
    expect(result.current.message).not.toBe('Sesión antigua');
  });

  it('does not start polling when a login-window response arrives after closing', async () => {
    vi.useFakeTimers();
    const pending = deferred<Awaited<ReturnType<typeof openSyslabLoginWindow>>>();
    vi.mocked(openSyslabLoginWindow).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ open }) => useSyslabAccess(open), {
      initialProps: { open: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      void result.current.openLogin();
    });
    rerender({ open: false });
    await act(async () => {
      pending.resolve({ bridgeAvailable: true, opened: true });
    });
    expect(result.current.isAwaitingLogin).toBe(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(requestSyslabExtensionStatus).toHaveBeenCalledTimes(1);
  });
  it('allows refresh after a failed request and stays idle while closed', async () => {
    vi.useFakeTimers();
    vi.mocked(requestSyslabExtensionStatus).mockRejectedValueOnce(new Error('bridge failed'));
    const { result, rerender } = renderHook(({ open }) => useSyslabAccess(open), {
      initialProps: { open: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe('unavailable');
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toBe('login-required');
    rerender({ open: false });
    await act(async () => {
      await result.current.refresh();
      await result.current.openLogin();
    });
    expect(requestSyslabExtensionStatus).toHaveBeenCalledTimes(2);
    expect(openSyslabLoginWindow).not.toHaveBeenCalled();
  });

  it('does not open duplicate login windows and recovers after an opening failure', async () => {
    vi.useFakeTimers();
    const pending = deferred<Awaited<ReturnType<typeof openSyslabLoginWindow>>>();
    vi.mocked(openSyslabLoginWindow).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useSyslabAccess(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      void result.current.openLogin();
      void result.current.openLogin();
    });
    expect(openSyslabLoginWindow).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ bridgeAvailable: false, opened: false });
    });
    expect(result.current.isOpening).toBe(false);
    vi.mocked(openSyslabLoginWindow).mockRejectedValueOnce(new Error('opening failed'));
    await act(async () => {
      await result.current.openLogin();
    });
    expect(result.current.isOpening).toBe(false);
    expect(result.current.isAwaitingLogin).toBe(false);
    await act(async () => {
      await result.current.openLogin();
    });
    expect(result.current.isAwaitingLogin).toBe(true);
  });
});
