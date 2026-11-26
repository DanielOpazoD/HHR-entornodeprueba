// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/application/auth/authSessionUseCases');

const mockSignInWithGoogle = vi.fn();
const mockHandleSignInRedirectResult = vi.fn();
const mockGetCurrentAuthSessionState = vi.fn();
const mockResolveCurrentAuthSessionState = vi.fn();
const mockIsPopupRecoverableAuthError = vi.fn();
const mockIsPopupCancellationAuthError = vi.fn();
const mockResolveAuthErrorCode = vi.fn();

vi.mock('@/services/auth/authGoogleFlow', () => ({
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

  it.each([false, true])(
    'forwards perfAttemptId independently of Google credential (credential: %s)',
    async hasCredential => {
      mockSignInWithGoogle.mockResolvedValue({
        uid: 'google-1',
        email: 'spec@hospital.cl',
        displayName: 'Spec',
        role: 'admin',
      });
      const credential = { idToken: 'synthetic-token', isCurrent: () => true };
      const outcome = await executeGoogleSignIn(
        hasCredential ? credential : undefined,
        'attempt-1'
      );
      expect(outcome.status).toBe('success');
      expect(mockSignInWithGoogle.mock.calls).toEqual([
        [
          hasCredential
            ? { googleCredential: credential, perfAttemptId: 'attempt-1' }
            : { perfAttemptId: 'attempt-1' },
        ],
      ]);
    }
  );

  it.each([false, true])(
    'preserves exact legacy service call without a perf ID (credential: %s)',
    async hasCredential => {
      mockSignInWithGoogle.mockResolvedValue({
        uid: 'google-1',
        email: 'spec@hospital.cl',
        displayName: 'Spec',
        role: 'admin',
      });
      const credential = { idToken: 'synthetic-token', isCurrent: () => true };
      await executeGoogleSignIn(hasCredential ? credential : undefined);
      expect(mockSignInWithGoogle.mock.calls).toEqual(
        hasCredential ? [[{ googleCredential: credential }]] : [[]]
      );
    }
  );

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
