import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { AuthUser } from '@/types/authRoleTypes';
import { useNursingSessionMonitor } from '@/hooks/useNursingSessionMonitor';

const state = vi.hoisted(() => ({
  current: null as User | null,
  ready: Promise.resolve(),
  watch: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    get ready() {
      return state.ready;
    },
    getCurrentUser: () => state.current,
  },
}));
vi.mock('@/services/auth/nursingSessionMonitor', () => ({
  watchNursingSession: state.watch,
}));

const nurse = (uid = 'hhrn_synthetic'): AuthUser => ({
  uid,
  email: `${uid}@accounts.hhr.invalid`,
  displayName: 'Enfermera Sintética',
  role: 'nurse_hospital',
});

describe('individual session monitor uses the canonical logout lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.ready = Promise.resolve();
    state.current = { uid: 'hhrn_synthetic' } as User;
    state.watch.mockReturnValue(state.stop);
  });

  it('routes revocation through automatic logout and detaches on unmount', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useNursingSessionMonitor(nurse(), logout));
    await waitFor(() => expect(state.watch).toHaveBeenCalledOnce());
    await act(() => state.watch.mock.calls[0][1]());
    expect(logout).toHaveBeenCalledExactlyOnceWith('automatic');
    unmount();
    expect(state.stop).toHaveBeenCalledOnce();
  });

  it('ignores a delayed result after replacement, even when the replacement has the same UID', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ user }) => useNursingSessionMonitor(user, logout), {
      initialProps: { user: nurse() },
    });
    await waitFor(() => expect(state.watch).toHaveBeenCalledOnce());
    const obsolete = state.watch.mock.calls[0][1];
    state.current = { uid: 'hhrn_synthetic' } as User;
    await act(() => obsolete());
    expect(logout).not.toHaveBeenCalled();
    rerender({ user: nurse() });
    await waitFor(() => expect(state.watch).toHaveBeenCalledTimes(2));
    await act(() => obsolete());
    expect(logout).not.toHaveBeenCalled();
    await act(() => state.watch.mock.calls[1][1]());
    expect(logout).toHaveBeenCalledExactlyOnceWith('automatic');
  });

  it('does not attach after unmount while initialization is pending', async () => {
    let resolveReady!: () => void;
    state.ready = new Promise<void>(resolve => {
      resolveReady = resolve;
    });
    const logout = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useNursingSessionMonitor(nurse(), logout));
    unmount();
    await act(async () => resolveReady());
    expect(state.watch).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('closes through normal cleanup if the monitor cannot initialize', async () => {
    state.watch.mockImplementationOnce(() => {
      throw new Error('monitor unavailable');
    });
    const logout = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useNursingSessionMonitor(nurse(), logout));
    await waitFor(() => expect(logout).toHaveBeenCalledExactlyOnceWith('automatic'));
  });

  it('leaves Google and unauthenticated sessions on their existing lifecycle', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ user }: { user: AuthUser | null }) => useNursingSessionMonitor(user, logout),
      { initialProps: { user: { ...nurse('google-user'), role: 'admin' } as AuthUser | null } }
    );
    rerender({ user: null });
    await act(async () => {});
    expect(state.watch).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
