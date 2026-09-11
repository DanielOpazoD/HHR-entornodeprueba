import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { AuthSessionState } from '@/types/authSessionTypes';
import { createCensusPerfModel } from '@/shared/runtime/censusPerfModel';
import {
  mountGoogleIdentityButton,
  type GoogleIdentityApi,
} from '@/services/auth/googleIdentityButton';

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
const mockBeginAuthPerfAttempt = vi.fn();
const mockReceiveAuthPerfCredential = vi.fn();
const mockRecordAuthPerfEvent = vi.fn();

vi.mock('@/shared/runtime/censusStartupPerf', () => ({
  beginAuthPerfAttempt: (...args: unknown[]) => mockBeginAuthPerfAttempt(...args),
  receiveAuthPerfCredential: (...args: unknown[]) => mockReceiveAuthPerfCredential(...args),
  recordAuthPerfEvent: (...args: unknown[]) => mockRecordAuthPerfEvent(...args),
}));

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
    mockBeginAuthPerfAttempt.mockReset().mockReturnValue('app-attempt');
    mockReceiveAuthPerfCredential.mockReset().mockReturnValue('credential-attempt');
    mockRecordAuthPerfEvent.mockReset();
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

  it('records the popup boundary and authorized outcome before notifying the caller', async () => {
    const onLoginSuccess = vi.fn(() => {
      expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['app-attempt', 'authorized']]);
    });
    const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
    await act(() => result.current.handleGoogleSignIn());
    expect(mockBeginAuthPerfAttempt.mock.calls).toEqual([['app_button']]);
    expect(mockExecuteGoogleSignIn.mock.calls).toEqual([[undefined, 'app-attempt']]);
    expect(mockReceiveAuthPerfCredential).not.toHaveBeenCalled();
    expect(onLoginSuccess).toHaveBeenCalledOnce();
  });

  it('uses the credential boundary helper without inventing a click or auditing token/user data', async () => {
    const credential = { idToken: 'synthetic-sensitive-token', isCurrent: () => true };
    const { result } = renderHook(() => useLoginPageController(vi.fn()));
    await act(() => result.current.handleGoogleSignIn(credential));
    expect(mockExecuteGoogleSignIn).toHaveBeenCalledWith(credential, 'credential-attempt');
    // The runtime owns GIS correlation and the credential_received fallback label.
    expect(mockReceiveAuthPerfCredential.mock.calls).toEqual([[]]);
    expect(mockBeginAuthPerfAttempt).not.toHaveBeenCalled();
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['credential-attempt', 'authorized']]);
    const auditCalls = JSON.stringify([
      mockReceiveAuthPerfCredential.mock.calls,
      mockBeginAuthPerfAttempt.mock.calls,
      mockRecordAuthPerfEvent.mock.calls,
    ]);
    expect(auditCalls).not.toContain(credential.idToken);
    expect(auditCalls).not.toContain('test@hospital.cl');
  });

  it.each([true, false])(
    'correlates GIS delivery with the real metrics model (observed click: %s)',
    async clicked => {
      let sequence = 0;
      const model = createCensusPerfModel({
        now: () => 10,
        id: () => 'attempt-' + ++sequence,
        timeOrigin: 0,
        environment: 'development',
      });
      mockBeginAuthPerfAttempt.mockImplementation(model.begin);
      mockReceiveAuthPerfCredential.mockImplementation(model.receiveCredential);
      mockRecordAuthPerfEvent.mockImplementation(model.auth);
      const onLoginSuccess = vi.fn();
      const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
      const api = { initialize: vi.fn(), renderButton: vi.fn(), cancel: vi.fn() };
      const dispose = mountGoogleIdentityButton(
        api,
        document.createElement('div'),
        'test-client',
        (idToken, isCurrent) => result.current.handleGoogleSignIn({ idToken, isCurrent })
      );
      const config = api.initialize.mock.calls[0][0] as Parameters<
        GoogleIdentityApi['initialize']
      >[0];
      const button = api.renderButton.mock.calls[0][1] as Parameters<
        GoogleIdentityApi['renderButton']
      >[1];
      await act(async () => {
        if (clicked) button.click_listener?.();
        config.callback({ credential: 'synthetic-sensitive-token' });
      });
      dispose();
      expect(onLoginSuccess).toHaveBeenCalledOnce();
      const attempts = model.snapshot().authAttempts;
      expect(attempts).toEqual([
        {
          id: 'attempt-2',
          boundary: clicked ? 'google_button' : 'credential_received',
          events: { started: 10, credential_received: 10, authorized: 10 },
        },
      ]);
      expect(JSON.stringify(model.snapshot())).not.toContain('synthetic-sensitive-token');
      expect(JSON.stringify(model.snapshot())).not.toContain('test@hospital.cl');
    }
  );

  it.each([false, true])(
    'preserves legacy arguments with metrics disabled (credential: %s)',
    async hasCredential => {
      mockBeginAuthPerfAttempt.mockReturnValue(undefined);
      mockReceiveAuthPerfCredential.mockReturnValue(undefined);
      const credential = { idToken: 'synthetic-token', isCurrent: () => true };
      const { result } = renderHook(() => useLoginPageController(vi.fn()));
      await act(() => result.current.handleGoogleSignIn(hasCredential ? credential : undefined));
      expect(mockExecuteGoogleSignIn.mock.calls).toEqual(hasCredential ? [[credential]] : [[]]);
    }
  );

  it('finishes each captured attempt ID when overlapping exchanges settle out of order', async () => {
    mockBeginAuthPerfAttempt.mockReturnValueOnce('first-popup');
    mockReceiveAuthPerfCredential.mockReturnValueOnce('second-gis');
    let resolveFirst!: (
      value: ReturnType<typeof createApplicationSuccess<AuthSessionState>>
    ) => void;
    mockExecuteGoogleSignIn.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        })
    );
    mockExecuteGoogleSignIn.mockRejectedValueOnce(new Error('second failed'));
    const { result } = renderHook(() => useLoginPageController(vi.fn()));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleGoogleSignIn();
      await result.current.handleGoogleSignIn({
        idToken: 'synthetic-token',
        isCurrent: () => true,
      });
    });
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['second-gis', 'failed']]);
    await act(async () => {
      resolveFirst(
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
      await first;
    });
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
      ['second-gis', 'failed'],
      ['first-popup', 'authorized'],
    ]);
  });

  it.each(['failed', 'thrown', 'cancelled', 'thrown-cancelled'])(
    'does not mark a %s exchange authorized',
    async failureMode => {
      const cancelled = failureMode.includes('cancelled');
      mockIsPopupCancellationAuthError.mockReturnValue(cancelled);
      if (failureMode === 'thrown' || failureMode === 'thrown-cancelled') {
        mockExecuteGoogleSignIn.mockRejectedValueOnce(new Error('exchange failed'));
      } else {
        mockExecuteGoogleSignIn.mockResolvedValueOnce(
          createApplicationFailed<AuthSessionState>({ status: 'unauthenticated', user: null }, [
            { kind: 'unknown', message: 'exchange failed' },
          ])
        );
      }
      const onLoginSuccess = vi.fn();
      const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
      await act(async () => {
        const pending = result.current.handleGoogleSignIn();
        await vi.advanceTimersByTimeAsync(600);
        await pending;
      });
      expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
        ['app-attempt', cancelled ? 'cancelled' : 'failed'],
      ]);
      expect(onLoginSuccess).not.toHaveBeenCalled();
      expect(result.current.isGoogleLoading).toBe(false);
    }
  );

  it('does not infer authorization from a successful wrapper with no authorized session', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationSuccess<AuthSessionState>({
        status: 'unauthenticated',
        user: null,
      })
    );
    const onLoginSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
    await act(() => result.current.handleGoogleSignIn());
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['app-attempt', 'failed']]);
    // Measurement does not change the existing controller's success handling.
    expect(onLoginSuccess).toHaveBeenCalledOnce();
  });

  it.each(['begin', 'receive', 'finish'])(
    'isolates a throwing %s audit hook from login',
    async hook => {
      const failAudit = () => {
        throw new Error('audit unavailable');
      };
      if (hook === 'begin') mockBeginAuthPerfAttempt.mockImplementationOnce(failAudit);
      if (hook === 'receive') mockReceiveAuthPerfCredential.mockImplementationOnce(failAudit);
      if (hook === 'finish') mockRecordAuthPerfEvent.mockImplementationOnce(failAudit);
      const onLoginSuccess = vi.fn();
      const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
      await act(() =>
        result.current.handleGoogleSignIn(
          hook === 'receive' ? { idToken: 'synthetic-token', isCurrent: () => true } : undefined
        )
      );
      expect(mockExecuteGoogleSignIn).toHaveBeenCalledOnce();
      expect(onLoginSuccess).toHaveBeenCalledOnce();
      expect(result.current.error).toBeNull();
      expect(result.current.isGoogleLoading).toBe(false);
      expect(mockRecordAuthPerfEvent).toHaveBeenCalledOnce();
    }
  );

  it('does not finalize twice if a success callback throws after the outcome was recorded', async () => {
    const { result } = renderHook(() =>
      useLoginPageController(() => {
        throw new Error('caller failed');
      })
    );
    await act(() => result.current.handleGoogleSignIn());
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['app-attempt', 'authorized']]);
    expect(result.current.error).toBe('caller failed');
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

  it('does not open another Google flow while a different HHR tab owns the login lock', async () => {
    window.localStorage.setItem(
      'hhr_google_login_lock_v1',
      JSON.stringify({ owner: 'other-tab', timestamp: Date.now() })
    );
    const { result } = renderHook(() => useLoginPageController(vi.fn()));

    await act(async () => {
      await result.current.handleGoogleSignIn();
    });

    expect(mockExecuteGoogleSignIn).not.toHaveBeenCalled();
    expect(mockBeginAuthPerfAttempt).not.toHaveBeenCalled();
    expect(mockReceiveAuthPerfCredential).not.toHaveBeenCalled();
    expect(mockRecordAuthPerfEvent).not.toHaveBeenCalled();
    expect(result.current.isGoogleLoading).toBe(false);
    expect(result.current.errorCode).toBe('auth/multi-tab-login-in-progress');
    expect(result.current.error).toMatch(/Otra pestaña de HHR/);
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
