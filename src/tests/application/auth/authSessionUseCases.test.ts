import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/application/auth/authSessionUseCases');

const mockSignIn = vi.fn();
const mockSignInWithGoogle = vi.fn();
const mockHandleSignInRedirectResult = vi.fn();
const mockGetCurrentAuthSessionState = vi.fn();
const mockResolveCurrentAuthSessionState = vi.fn();
const mockIsPopupRecoverableAuthError = vi.fn();
const mockIsPopupCancellationAuthError = vi.fn();
const mockResolveAuthErrorCode = vi.fn();

vi.mock('@/services/auth/authFlow', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
}));

vi.mock('@/services/auth/authSession', () => ({
  getCurrentAuthSessionState: (...args: unknown[]) => mockGetCurrentAuthSessionState(...args),
  resolveCurrentAuthSessionState: (...args: unknown[]) =>
    mockResolveCurrentAuthSessionState(...args),
}));

vi.mock('@/services/auth/authFallback', () => ({
  handleSignInRedirectResult: (...args: unknown[]) => mockHandleSignInRedirectResult(...args),
}));

vi.mock('@/services/auth/authErrorPolicy', () => ({
  isPopupRecoverableAuthError: (...args: unknown[]) => mockIsPopupRecoverableAuthError(...args),
  isPopupCancellationAuthError: (...args: unknown[]) => mockIsPopupCancellationAuthError(...args),
  resolveAuthErrorCode: (...args: unknown[]) => mockResolveAuthErrorCode(...args),
}));

import {
  executeCredentialSignIn,
  executeCurrentAuthSessionState,
  executeGoogleSignIn,
  executeResolvedCurrentAuthSessionState,
  executeRedirectAuthResolution,
} from '@/application/auth/authSessionUseCases';

describe('authSessionUseCases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPopupRecoverableAuthError.mockReturnValue(false);
    mockIsPopupCancellationAuthError.mockReturnValue(false);
    mockResolveAuthErrorCode.mockReturnValue(null);
  });

  it('returns success outcome for google sign-in', async () => {
    mockSignInWithGoogle.mockResolvedValue({
      uid: 'google-1',
      email: 'spec@hospital.cl',
      displayName: 'Spec',
      role: 'doctor_specialist',
    });

    const outcome = await executeGoogleSignIn();

    expect(outcome.status).toBe('success');
    expect(outcome.data).toEqual(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({
          uid: 'google-1',
        }),
      })
    );
  });

  it('returns failed outcome with retryable metadata for recoverable google errors', async () => {
    mockSignInWithGoogle.mockRejectedValue(new Error('popup blocked'));
    mockResolveAuthErrorCode.mockReturnValue('auth/popup-blocked');
    mockIsPopupRecoverableAuthError.mockReturnValue(true);

    const outcome = await executeGoogleSignIn();

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('auth/popup-blocked');
    expect(outcome.retryable).toBe(true);
    expect(outcome.data.status).toBe('auth_error');
  });

  it('returns retryable cancellation metadata without classifying it as popup blocking', async () => {
    mockSignInWithGoogle.mockRejectedValue(
      Object.assign(new Error('Inicio de sesión cancelado. Intenta nuevamente desde el botón.'), {
        code: 'auth/cancelled-popup-request',
      })
    );
    mockResolveAuthErrorCode.mockReturnValue('auth/cancelled-popup-request');
    mockIsPopupRecoverableAuthError.mockReturnValue(false);
    mockIsPopupCancellationAuthError.mockReturnValue(true);

    const outcome = await executeGoogleSignIn();

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('auth/cancelled-popup-request');
    expect(outcome.retryable).toBe(true);
    expect(outcome.severity).toBe('warning');
    expect(outcome.data.status).toBe('auth_error');
  });

  it('returns success outcome for credential sign-in', async () => {
    mockSignIn.mockResolvedValue({
      uid: 'cred-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    });

    const outcome = await executeCredentialSignIn('  Admin@Hospital.cl ', 'secret');

    expect(outcome.status).toBe('success');
    expect(outcome.data.status).toBe('authorized');
    expect(mockSignIn).toHaveBeenCalledWith('admin@hospital.cl', 'secret');
  });

  it('returns failed outcome when credential sign-in email is invalid and avoids auth call', async () => {
    const outcome = await executeCredentialSignIn('correo-invalido', 'secret');

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('auth/credential-invalid-email');
    expect(outcome.data.status).toBe('auth_error');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('returns failed outcome when credential sign-in password is missing', async () => {
    const outcome = await executeCredentialSignIn('admin@hospital.cl', '');

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('auth/credential-missing-password');
    expect(outcome.data.status).toBe('auth_error');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('returns failed outcome when redirect resolution surfaces an auth error state', async () => {
    mockHandleSignInRedirectResult.mockResolvedValue({
      status: 'auth_error',
      user: null,
      error: {
        code: 'auth_redirect_result_failed',
        message: 'redirect failed',
        userSafeMessage: 'redirect failed',
        retryable: true,
        severity: 'warning',
      },
    });

    const outcome = await executeRedirectAuthResolution();

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('auth_redirect_result_failed');
  });

  it('returns current auth session state as success outcome', () => {
    mockGetCurrentAuthSessionState.mockReturnValue({
      status: 'anonymous_signature',
      user: {
        uid: 'anon-1',
        email: null,
        displayName: 'Anonymous Doctor',
        role: 'viewer',
      },
    });

    const outcome = executeCurrentAuthSessionState();

    expect(outcome.status).toBe('success');
    expect(outcome.data.status).toBe('anonymous_signature');
  });

  it('returns resolved current auth session state when a persisted firebase session already exists', async () => {
    mockResolveCurrentAuthSessionState.mockResolvedValue({
      status: 'authorized',
      user: {
        uid: 'existing-1',
        email: 'existing@hospital.cl',
        displayName: 'Existing User',
        role: 'admin',
      },
    });

    const outcome = await executeResolvedCurrentAuthSessionState();

    expect(outcome.status).toBe('success');
    expect(outcome.data).toEqual(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({
          uid: 'existing-1',
        }),
      })
    );
  });
});
