import type { AuthSessionError, AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';

export const createAuthenticatingAuthSessionState = (): AuthSessionState => ({
  status: 'authenticating',
  user: null,
});

export const createUnauthenticatedAuthSessionState = (): AuthSessionState => ({
  status: 'unauthenticated',
  user: null,
});

export const createUnauthorizedAuthSessionState = (
  reason?: string,
  technicalContext?: Record<string, unknown>
): AuthSessionState => ({
  status: 'unauthorized',
  user: null,
  ...(reason ? { reason } : {}),
  ...(technicalContext ? { technicalContext } : {}),
});

export const createAuthErrorSessionState = (error: AuthSessionError): AuthSessionState => ({
  status: 'auth_error',
  user: null,
  error,
});

export const toResolvedAuthSessionState = (user: AuthUser): AuthSessionState => {
  return {
    status: 'authorized',
    user,
  };
};

export const toAnonymousSignatureAuthSessionState = (user: AuthUser): AuthSessionState => ({
  status: 'anonymous_signature',
  user,
});

export const getAuthSessionStateUser = (sessionState: AuthSessionState): AuthUser | null =>
  sessionState.user;

export const isAuthenticatedAuthSessionState = (
  sessionState: AuthSessionState
): sessionState is Extract<AuthSessionState, { status: 'authorized' | 'anonymous_signature' }> =>
  sessionState.status === 'authorized' || sessionState.status === 'anonymous_signature';
