import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { AuthSessionState } from '@/types/authSessionTypes';

const mockExecuteGoogleSignIn = vi.fn();
const mockExecuteGoogleSignInWarmup = vi.fn();
const mockIsPopupRecoverableAuthError = vi.fn();
const mockIsPopupOpenFailureAuthError = vi.fn();
const mockResolveAuthErrorCode = vi.fn();
const mockIsPopupCancellationAuthError = vi.fn();
const mockIsAuthBootstrapPending = vi.fn();
const mockClearAuthBootstrapPending = vi.fn();
const mockGetCurrentAuthSessionState = vi.fn();
const mockPreloadDefaultPostLoginRoute = vi.fn();

vi.mock('@/application/auth/authSessionUseCases', () => ({
  executeGoogleSignIn: (...args: unknown[]) => mockExecuteGoogleSignIn(...args),
  executeGoogleSignInWarmup: (...args: unknown[]) => mockExecuteGoogleSignInWarmup(...args),
}));

vi.mock('@/services/auth/authErrorPolicy', () => ({
  isPopupRecoverableAuthError: (...args: unknown[]) => mockIsPopupRecoverableAuthError(...args),
  isPopupOpenFailureAuthError: (...args: unknown[]) => mockIsPopupOpenFailureAuthError(...args),
  isPopupCancellationAuthError: (...args: unknown[]) => mockIsPopupCancellationAuthError(...args),
  resolveAuthErrorCode: (...args: unknown[]) => mockResolveAuthErrorCode(...args),
}));

vi.mock('@/services/auth/authBootstrapState', () => ({
  isAuthBootstrapPending: (...args: unknown[]) => mockIsAuthBootstrapPending(...args),
  clearAuthBootstrapPending: (...args: unknown[]) => mockClearAuthBootstrapPending(...args),
}));

vi.mock('@/services/auth/authSession', () => ({
  getCurrentAuthSessionState: (...args: unknown[]) => mockGetCurrentAuthSessionState(...args),
}));

vi.mock('@/app-shell/bootstrap/authenticatedRoutePreloadController', () => ({
  preloadDefaultPostLoginRoute: (...args: unknown[]) => mockPreloadDefaultPostLoginRoute(...args),
}));

import { useLoginPageController } from '@/features/auth/components/useLoginPageController';

describe('useLoginPageController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockIsPopupRecoverableAuthError.mockReturnValue(false);
    mockIsPopupOpenFailureAuthError.mockReturnValue(false);
    mockIsPopupCancellationAuthError.mockReturnValue(false);
    mockResolveAuthErrorCode.mockReturnValue(null);
    mockIsAuthBootstrapPending.mockReturnValue(false);
    mockGetCurrentAuthSessionState.mockReturnValue({
      status: 'unauthenticated',
      user: null,
    });
    mockPreloadDefaultPostLoginRoute.mockResolvedValue(undefined);
    mockExecuteGoogleSignIn.mockResolvedValue(
      createApplicationSuccess<AuthSessionState>({
        status: 'authorized',
        user: {
          uid: 'google-1',
          email: 'test@hospital.cl',
          displayName: 'Google User',
          role: 'admin',
        },
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('initializes from the persisted login background mode', () => {
    window.localStorage.setItem('hhr_login_background_mode', 'night');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    expect(result.current.backgroundMode).toBe('night');
    expect(result.current.isDayGradient).toBe(false);
  });

  it('keeps the login mount light and defers the post-login route preload', () => {
    renderHook(() => useLoginPageController(vi.fn()));

    expect(mockPreloadDefaultPostLoginRoute).not.toHaveBeenCalled();
  });

  it('surfaces a bootstrap auth error passed from the app shell', () => {
    const { result } = renderHook(() =>
      useLoginPageController(vi.fn(), {
        code: 'auth/bootstrap-timeout',
        message: 'No se pudo confirmar la sesion con Google en este navegador.',
      })
    );

    expect(result.current.errorCode).toBe('auth/bootstrap-timeout');
    expect(result.current.error).toBe(
      'No se pudo confirmar la sesion con Google en este navegador.'
    );
  });

  it('persists manual login background mode changes across refreshes', () => {
    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    act(() => {
      result.current.toggleBackgroundMode();
    });

    expect(window.localStorage.getItem('hhr_login_background_mode')).toBe(
      result.current.backgroundMode
    );
  });

  it('calls onLoginSuccess when Google login succeeds', async () => {
    const events: string[] = [];
    const onLoginSuccess = vi.fn();
    mockPreloadDefaultPostLoginRoute.mockImplementation(async () => {
      events.push('preload');
    });
    mockExecuteGoogleSignIn.mockImplementationOnce(async () => {
      events.push('sign-in');
      return createApplicationSuccess<AuthSessionState>({
        status: 'authorized',
        user: {
          uid: 'google-1',
          email: 'test@hospital.cl',
          displayName: 'Google User',
          role: 'admin',
        },
      });
    });
    const { result } = renderHook(() => useLoginPageController(onLoginSuccess));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.runAllTimersAsync();
      await promise;
    });

    expect(mockExecuteGoogleSignIn).toHaveBeenCalledTimes(1);
    // Preloaded on the successful sign-in and once more by the deferred idle
    // warm-up scheduled at mount.
    expect(mockPreloadDefaultPostLoginRoute).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['sign-in', 'preload', 'preload']);
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('keeps the user on the same login screen when the popup has a recoverable issue', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/popup-blocked',
            message: 'popup blocked',
          },
        },
        [{ kind: 'unknown', code: 'auth/popup-blocked', message: 'popup blocked' }]
      )
    );
    mockIsPopupRecoverableAuthError.mockReturnValueOnce(true);
    mockIsPopupOpenFailureAuthError.mockReturnValue(true);
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/popup-blocked');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.advanceTimersByTimeAsync(1800);
      await promise;
    });

    expect(result.current.errorCode).toBe('auth/popup-blocked');
    expect(result.current.error).toBe(AUTH_UI_COPY.blockedPopupStayOnPage);
    expect(result.current.isGoogleLoading).toBe(false);
    expect(result.current.isAnyLoading).toBe(false);
    expect(window.sessionStorage.getItem('hhr_google_login_attempt_pending')).toBeNull();
  });

  it('keeps the accurate timeout message instead of blaming the popup blocker', async () => {
    const timeoutMessage =
      'El ingreso con Google está tardando más de lo esperado. Si la ventana de Google sigue abierta, puedes completar el acceso ahí; si no, inténtalo nuevamente desde el botón.';
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/popup-timeout',
            message: timeoutMessage,
          },
        },
        [
          {
            kind: 'unknown',
            code: 'auth/popup-timeout',
            message: timeoutMessage,
            userSafeMessage: timeoutMessage,
          },
        ]
      )
    );
    mockIsPopupRecoverableAuthError.mockReturnValueOnce(true);
    mockIsPopupOpenFailureAuthError.mockReturnValue(false);
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/popup-timeout');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.advanceTimersByTimeAsync(1800);
      await promise;
    });

    expect(result.current.errorCode).toBe('auth/popup-timeout');
    expect(result.current.error).toBe(timeoutMessage);
    expect(result.current.error).not.toBe(AUTH_UI_COPY.blockedPopupStayOnPage);
    expect(result.current.isGoogleLoading).toBe(false);
  });

  it('clears a stale bootstrap auth error locally before running the reset action', () => {
    const { result, rerender } = renderHook(
      ({ initialAuthError }) => useLoginPageController(vi.fn(), initialAuthError),
      {
        initialProps: {
          initialAuthError: {
            code: 'auth/bootstrap-timeout',
            message: 'No se pudo confirmar la sesion con Google en este navegador.',
          },
        },
      }
    );

    expect(result.current.errorCode).toBe('auth/bootstrap-timeout');

    act(() => {
      result.current.handleLocalResetStart();
    });
    rerender({
      initialAuthError: {
        code: 'auth/bootstrap-timeout',
        message: 'No se pudo confirmar la sesion con Google en este navegador.',
      },
    });

    expect(result.current.error).toBeNull();
    expect(result.current.errorCode).toBeNull();
  });

  it('returns quietly to idle when the Google popup request was cancelled', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/cancelled-popup-request',
            message: 'Inicio de sesión cancelado. Intenta nuevamente desde el botón principal.',
          },
        },
        [
          {
            kind: 'unknown',
            code: 'auth/cancelled-popup-request',
            message: 'Inicio de sesión cancelado. Intenta nuevamente desde el botón principal.',
          },
        ]
      )
    );
    mockIsPopupRecoverableAuthError.mockReturnValueOnce(false);
    mockIsPopupCancellationAuthError.mockReturnValueOnce(true);
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/cancelled-popup-request');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.advanceTimersByTimeAsync(600);
      await promise;
    });

    expect(result.current.errorCode).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isGoogleLoading).toBe(false);
    expect(window.sessionStorage.getItem('hhr_google_login_attempt_pending')).toBeNull();
  });

  it('does not retain a blocked-popup alert after the user closes the Google account picker', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/popup-closed-by-user',
            message: 'Inicio de sesión cancelado. Intenta nuevamente desde el botón principal.',
          },
        },
        [
          {
            kind: 'unknown',
            code: 'auth/popup-closed-by-user',
            message: 'Inicio de sesión cancelado. Intenta nuevamente desde el botón principal.',
          },
        ]
      )
    );
    mockIsPopupRecoverableAuthError.mockReturnValueOnce(true);
    mockIsPopupCancellationAuthError.mockReturnValueOnce(true);
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/popup-closed-by-user');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.advanceTimersByTimeAsync(600);
      await promise;
    });

    expect(result.current.errorCode).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.error).not.toBe(AUTH_UI_COPY.blockedPopupStayOnPage);
    expect(result.current.isGoogleLoading).toBe(false);
  });

  it('surfaces non-recoverable popup errors without switching flows', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/google-signin-failed',
            message: 'google auth down',
          },
        },
        [{ kind: 'unknown', code: 'auth/google-signin-failed', message: 'google auth down' }]
      )
    );
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/google-signin-failed');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.runAllTimersAsync();
      await promise;
    });

    expect(result.current.errorCode).toBe('auth/google-signin-failed');
    expect(result.current.error).toBe('google auth down');
    expect(result.current.isGoogleLoading).toBe(false);
    expect(result.current.canRetryGoogleSignIn).toBe(false);
  });

  it('enables explicit retry when Google auth resolves with temporary access validation failure', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/role-validation-unavailable',
            message:
              'No se pudo validar tu acceso en este momento. Intenta nuevamente en unos segundos.',
          },
        },
        [
          {
            kind: 'unknown',
            code: 'auth/role-validation-unavailable',
            message:
              'No se pudo validar tu acceso en este momento. Intenta nuevamente en unos segundos.',
          },
        ]
      )
    );
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/role-validation-unavailable');

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.runAllTimersAsync();
      await promise;
    });

    expect(result.current.errorCode).toBe('auth/role-validation-unavailable');
    expect(result.current.canRetryGoogleSignIn).toBe(true);
  });

  it('suppresses recoverable popup warnings when auth session resolves during the grace window', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationFailed<AuthSessionState>(
        {
          status: 'auth_error',
          user: null,
          error: {
            code: 'auth/popup-blocked',
            message: 'popup blocked',
          },
        },
        [{ kind: 'unknown', code: 'auth/popup-blocked', message: 'popup blocked' }]
      )
    );
    mockIsPopupRecoverableAuthError.mockReturnValueOnce(true);
    mockResolveAuthErrorCode.mockReturnValueOnce('auth/popup-blocked');
    mockGetCurrentAuthSessionState
      .mockReturnValueOnce({ status: 'unauthenticated', user: null })
      .mockReturnValueOnce({
        status: 'authorized',
        user: {
          uid: 'specialist-1',
          email: 'specialist@hospital.cl',
          displayName: 'Especialista',
          role: 'doctor_specialist',
        },
      });

    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      const promise = result.current.handleGoogleSignIn();
      await vi.advanceTimersByTimeAsync(1800);
      await promise;
    });

    expect(result.current.errorCode).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
