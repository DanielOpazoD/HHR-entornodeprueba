import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { AuthSessionState } from '@/types/authSessionTypes';
import {
  authBootstrapTestMocks,
  flushBootstrapSetup,
  installResolvedAuthBootstrapTestLifecycle,
  renderResolvedAuthBootstrap,
} from './useAuthStateSupport.testUtils';

// @flake-safe Covered by the shared fake-timer lifecycle in useAuthStateSupport.testUtils.
describe('useResolvedAuthBootstrap session resolution', () => {
  installResolvedAuthBootstrapTestLifecycle();

  it('hydrates the current firebase session before the auth observer resolves', async () => {
    const onAuthSessionStateChange = vi.fn(() => () => {});
    const resolveRedirectAuthSessionOutcome = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });
    const resolveCurrentAuthSessionOutcome = vi.fn().mockResolvedValue({
      status: 'success',
      data: {
        status: 'authorized',
        user: {
          uid: 'existing-1',
          email: 'existing@hospital.cl',
          displayName: 'Existing Session',
          role: 'admin',
        },
      },
      issues: [],
    });

    const { result } = renderResolvedAuthBootstrap({
      resolveRedirectAuthSessionOutcome,
      resolveCurrentAuthSessionOutcome,
      onAuthSessionStateChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.authLoading).toBe(false);
    expect(result.current.sessionState).toEqual(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({
          uid: 'existing-1',
        }),
      })
    );
    expect(authBootstrapTestMocks.mockRecordOperationalOutcome).toHaveBeenCalledWith(
      'auth',
      'current_session_resolution',
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({ allowSuccess: true })
    );
  });

  it('resolves immediately to unauthenticated when no persisted session hints exist', async () => {
    const onAuthSessionStateChange = vi.fn(() => () => {});
    const resolveRedirectAuthSessionOutcome = vi
      .fn<() => Promise<ApplicationOutcome<AuthSessionState | null>>>()
      .mockResolvedValue({
        status: 'success',
        data: null,
        issues: [],
      });
    const resolveCurrentAuthSessionOutcome = vi
      .fn<() => Promise<ApplicationOutcome<AuthSessionState | null>>>()
      .mockResolvedValue({
        status: 'success',
        data: null,
        issues: [],
      });

    const { result } = renderResolvedAuthBootstrap({
      resolveRedirectAuthSessionOutcome,
      resolveCurrentAuthSessionOutcome,
      onAuthSessionStateChange,
      initialSessionState: {
        status: 'authenticating',
        user: null,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(result.current.authLoading).toBe(false);
      expect(result.current.sessionState).toEqual({
        status: 'unauthenticated',
        user: null,
      });
    });
    expect(authBootstrapTestMocks.mockClearAuthBootstrapPending).toHaveBeenCalled();
  });

  it('does not resolve immediately to unauthenticated during same-tab session rehydration', async () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    const onAuthSessionStateChange = vi.fn(() => () => {});
    const resolveRedirectAuthSessionOutcome = vi
      .fn<() => Promise<ApplicationOutcome<AuthSessionState | null>>>()
      .mockResolvedValue({
        status: 'success',
        data: null,
        issues: [],
      });
    const resolveCurrentAuthSessionOutcome = vi
      .fn<() => Promise<ApplicationOutcome<AuthSessionState | null>>>()
      .mockResolvedValue({
        status: 'success',
        data: null,
        issues: [],
      });

    const { result, unmount } = renderResolvedAuthBootstrap({
      resolveRedirectAuthSessionOutcome,
      resolveCurrentAuthSessionOutcome,
      onAuthSessionStateChange,
      initialSessionState: {
        status: 'authenticating',
        user: null,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.authLoading).toBe(true);
    expect(result.current.sessionState).toEqual({
      status: 'authenticating',
      user: null,
    });
    unmount();
    vi.clearAllTimers();
  });

  it('applies a failed current-session resolution immediately when it already includes an auth terminal state', async () => {
    const onAuthSessionStateChange = vi.fn(() => () => {});
    const resolveRedirectAuthSessionOutcome = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });
    const resolveCurrentAuthSessionOutcome = vi.fn().mockResolvedValue({
      status: 'failed',
      data: {
        status: 'auth_error',
        user: null,
        error: {
          code: 'auth_session_state_resolution_failed',
          message: 'No se pudo resolver la sesion actual.',
          userSafeMessage: 'No se pudo resolver la sesion actual.',
          retryable: true,
          severity: 'warning',
        },
      },
      issues: [
        {
          kind: 'unknown',
          code: 'auth_session_state_resolution_failed',
          message: 'No se pudo resolver la sesion actual.',
        },
      ],
      reason: 'auth_session_state_resolution_failed',
      retryable: true,
      severity: 'warning',
    });

    const { result } = renderResolvedAuthBootstrap({
      resolveRedirectAuthSessionOutcome,
      resolveCurrentAuthSessionOutcome,
      onAuthSessionStateChange,
      initialSessionState: {
        status: 'authenticating',
        user: null,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.authLoading).toBe(false);
    expect(result.current.sessionState).toEqual(
      expect.objectContaining({
        status: 'auth_error',
        error: expect.objectContaining({
          code: 'auth_session_state_resolution_failed',
        }),
      })
    );
  });

  it('ignores a transient unauthenticated auth event while a persisted Firebase session still exists', async () => {
    window.localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');

    const onAuthSessionStateChange = vi.fn(
      (callback: (sessionState: AuthSessionState) => void | Promise<void>) => {
        setTimeout(() => {
          void callback({
            status: 'unauthenticated',
            user: null,
          });
        }, 10);
        setTimeout(() => {
          void callback({
            status: 'authorized',
            user: {
              uid: 'persisted-1',
              email: 'persisted@hospital.cl',
              displayName: 'Persisted Session',
              role: 'admin',
            },
          });
        }, 100);
        return () => {};
      }
    );
    const resolveRedirectAuthSessionOutcome = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });
    const resolveCurrentAuthSessionOutcome = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });

    const { result } = renderResolvedAuthBootstrap({
      resolveRedirectAuthSessionOutcome,
      resolveCurrentAuthSessionOutcome,
      onAuthSessionStateChange,
      initialSessionState: {
        status: 'authenticating',
        user: null,
      },
    });

    await act(async () => {
      await flushBootstrapSetup();
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(result.current.authLoading).toBe(false);
    expect(result.current.sessionState).toEqual(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({ uid: 'persisted-1' }),
      })
    );
  });
});
