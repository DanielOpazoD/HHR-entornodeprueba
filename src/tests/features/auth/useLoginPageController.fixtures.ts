import { afterEach, beforeEach, vi } from 'vitest';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';
import type { AuthSessionState } from '@/types/authSessionTypes';

const {
  mockExecuteGoogleSignIn,
  mockExecuteGoogleSignInWarmup,
  mockIsPopupRecoverableAuthError,
  mockIsPopupOpenFailureAuthError,
  mockResolveAuthErrorCode,
  mockIsPopupCancellationAuthError,
  mockIsAuthBootstrapPending,
  mockClearAuthBootstrapPending,
  mockGetCurrentAuthSessionState,
  mockPreloadDefaultPostLoginRoute,
  mockBeginAuthPerfAttempt,
  mockReceiveAuthPerfCredential,
  mockRecordAuthPerfEvent,
} = vi.hoisted(() => ({
  mockExecuteGoogleSignIn: vi.fn(),
  mockExecuteGoogleSignInWarmup: vi.fn(),
  mockIsPopupRecoverableAuthError: vi.fn(),
  mockIsPopupOpenFailureAuthError: vi.fn(),
  mockResolveAuthErrorCode: vi.fn(),
  mockIsPopupCancellationAuthError: vi.fn(),
  mockIsAuthBootstrapPending: vi.fn(),
  mockClearAuthBootstrapPending: vi.fn(),
  mockGetCurrentAuthSessionState: vi.fn(),
  mockPreloadDefaultPostLoginRoute: vi.fn(),
  mockBeginAuthPerfAttempt: vi.fn(),
  mockReceiveAuthPerfCredential: vi.fn(),
  mockRecordAuthPerfEvent: vi.fn(),
}));

export {
  mockExecuteGoogleSignIn,
  mockExecuteGoogleSignInWarmup,
  mockIsPopupRecoverableAuthError,
  mockIsPopupOpenFailureAuthError,
  mockResolveAuthErrorCode,
  mockIsPopupCancellationAuthError,
  mockIsAuthBootstrapPending,
  mockClearAuthBootstrapPending,
  mockGetCurrentAuthSessionState,
  mockPreloadDefaultPostLoginRoute,
  mockBeginAuthPerfAttempt,
  mockReceiveAuthPerfCredential,
  mockRecordAuthPerfEvent,
};

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

export const setupLoginPageControllerTests = () => {
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
};
