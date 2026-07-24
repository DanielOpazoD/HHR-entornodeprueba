import { describe, expect, it } from 'vitest';
import {
  isPopupCancellationAuthError,
  isPopupRecoverableAuthError,
  resolveAuthErrorCode,
  shouldDowngradeGoogleAuthLogLevel,
  toGoogleAuthError,
} from '@/services/auth/authErrorPolicy';

describe('authErrorPolicy', () => {
  it('resolves explicit auth codes', () => {
    expect(resolveAuthErrorCode({ code: 'auth/popup-blocked' })).toBe('auth/popup-blocked');
  });

  it('infers COOP popup blocked code from message', () => {
    const code = resolveAuthErrorCode({
      message: 'INTERNAL ASSERTION FAILED: Cross-Origin-Opener-Policy',
    });
    expect(code).toBe('auth/popup-coop-blocked');
    expect(isPopupRecoverableAuthError({ message: 'INTERNAL ASSERTION FAILED' })).toBe(true);
  });

  it('maps unknown auth error to fallback error code', () => {
    const err = toGoogleAuthError({ message: 'unexpected crash' }) as Error & { code: string };
    expect(err.code).toBe('auth/google-signin-failed');
    expect(err.message).toContain('Error al iniciar sesión con Google');
  });

  it('returns user-facing message for popup blocked', () => {
    const err = toGoogleAuthError({ code: 'auth/popup-blocked' }) as Error & { code: string };
    expect(err.code).toBe('auth/popup-blocked');
    expect(err.message).toContain('ventana de Google');
  });

  it('treats popup timeout as recoverable and user-facing', () => {
    const err = toGoogleAuthError({
      message: 'El login con Google no respondió a tiempo.',
    }) as Error & { code: string };
    expect(err.code).toBe('auth/popup-timeout');
    expect(err.message).toContain('tardando más de lo esperado');
    expect(isPopupRecoverableAuthError(err)).toBe(true);
  });

  it('does not classify a cancelled popup request as browser popup blocking', () => {
    const err = toGoogleAuthError({
      code: 'auth/cancelled-popup-request',
    }) as Error & { code: string };

    expect(err.code).toBe('auth/cancelled-popup-request');
    expect(err.message).toContain('cancelado');
    expect(isPopupCancellationAuthError(err)).toBe(true);
    expect(isPopupRecoverableAuthError(err)).toBe(false);
  });

  it('infers a user-closed popup from Firebase popup-closed messages', () => {
    const err = toGoogleAuthError({
      message: 'Firebase: Error (auth/popup-closed-by-user).',
    }) as Error & { code: string };

    expect(err.code).toBe('auth/popup-closed-by-user');
    expect(err.message).toContain('cancelado');
    expect(isPopupCancellationAuthError(err)).toBe(true);
    expect(isPopupRecoverableAuthError(err)).toBe(false);
  });

  it('downgrades recoverable popup errors to warning log level', () => {
    expect(
      shouldDowngradeGoogleAuthLogLevel({
        message: 'INTERNAL ASSERTION FAILED: Cross-Origin-Opener-Policy',
      })
    ).toBe(true);
    expect(shouldDowngradeGoogleAuthLogLevel({ message: 'fatal unknown error' })).toBe(false);
  });
});
