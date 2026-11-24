import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionState } from '@/types/authSessionTypes';
import {
  authBootstrapTestMocks,
  flushBootstrapSetup,
  installResolvedAuthBootstrapTestLifecycle,
  renderResolvedAuthBootstrap,
} from './useAuthStateSupport.testUtils';

// @flake-safe Covered by the shared fake-timer lifecycle in useAuthStateSupport.testUtils.
describe('useResolvedAuthBootstrap timeout handling', () => {
  installResolvedAuthBootstrapTestLifecycle();

  it('cancels the safety timeout once auth state resolves', async () => {
    window.sessionStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"persisted"}');

    const onAuthSessionStateChange = vi.fn(
      (callback: (sessionState: AuthSessionState) => void | Promise<void>) => {
        setTimeout(() => {
          void callback({
            status: 'authorized',
            user: {
              uid: 'specialist-1',
              email: 'specialist@hospital.cl',
              displayName: 'Especialista',
              role: 'doctor_specialist',
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
    });

    await act(async () => {
      await flushBootstrapSetup();
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.authLoading).toBe(false);
    expect(result.current.sessionState.status).toBe('authorized');

    await act(async () => {
      await flushBootstrapSetup();
      await vi.advanceTimersByTimeAsync(16000);
    });

    expect(authBootstrapTestMocks.mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining('Auth initialization timed out'),
      expect.anything()
    );
    expect(authBootstrapTestMocks.mockRecordOperationalOutcome).toHaveBeenCalledWith(
      'auth',
      'redirect_resolution',
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({ allowSuccess: true })
    );
  });

  it('forces auth loading completion on bootstrap timeout', async () => {
    window.sessionStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"persisted"}');
    authBootstrapTestMocks.mockHasActiveFirebaseSession.mockReturnValue(true);

    const onAuthSessionStateChange = vi.fn(() => () => {});
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
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });

    expect(result.current.authLoading).toBe(false);
    expect(authBootstrapTestMocks.mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Auth initialization timed out'),
      expect.anything()
    );
    expect(authBootstrapTestMocks.mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'auth',
        operation: 'bootstrap_timeout',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          budgetProfile: 'default',
          pendingAgeMs: 0,
        }),
      })
    );
  });

  it('revalidates the current session on timeout before falling back to unauthenticated', async () => {
    window.sessionStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"persisted"}');
    authBootstrapTestMocks.mockHasActiveFirebaseSession.mockReturnValue(true);

    const onAuthSessionStateChange = vi.fn(() => () => {});
    const resolveRedirectAuthSessionOutcome = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });
    const resolveCurrentAuthSessionOutcome = vi
      .fn()
      .mockResolvedValueOnce({ status: 'success', data: null, issues: [] })
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          status: 'authorized',
          user: {
            uid: 'persisted-1',
            email: 'persisted@hospital.cl',
            displayName: 'Persisted Session',
            role: 'admin',
          },
        },
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
      await flushBootstrapSetup();
      await vi.advanceTimersByTimeAsync(16000);
      await Promise.resolve();
    });

    expect(result.current.authLoading).toBe(false);
    expect(result.current.sessionState).toEqual(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({ uid: 'persisted-1' }),
      })
    );
    expect(resolveCurrentAuthSessionOutcome).toHaveBeenCalledTimes(2);
    expect(authBootstrapTestMocks.mockRecordOperationalOutcome).toHaveBeenCalledWith(
      'auth',
      'timeout_current_session_resolution',
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({ allowSuccess: true })
    );
  });
});
