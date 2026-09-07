import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import type { ComponentType, PropsWithChildren } from 'react';
import type { AuthSessionState } from '@/types/authSessionTypes';
import { useResolvedAuthBootstrap } from '@/hooks/useAuthStateSupport';

const mockWarn = vi.fn();
const mockInfo = vi.fn();
const mockIsAuthBootstrapPending = vi.fn();
const mockGetAuthBootstrapPendingAgeMs = vi.fn();
const mockClearAuthBootstrapPending = vi.fn();
const mockRestoreAuthBootstrapReturnTo = vi.fn();
const mockClearRecentManualLogout = vi.fn();
const mockHasRecentManualLogout = vi.fn();
const mockHasActiveFirebaseSession = vi.fn();
const mockLogUserLogin = vi.fn();
const mockRecordOperationalOutcome = vi.fn();
const mockRecordOperationalTelemetry = vi.fn();

vi.mock('@/services/utils/loggerService', () => ({
  logger: {
    child: () => ({
      warn: (...args: unknown[]) => mockWarn(...args),
      info: (...args: unknown[]) => mockInfo(...args),
    }),
  },
}));

vi.mock('@/services/auth/authBootstrapState', () => ({
  clearAuthBootstrapPending: () => mockClearAuthBootstrapPending(),
  getAuthBootstrapPendingAgeMs: () => mockGetAuthBootstrapPendingAgeMs(),
  isAuthBootstrapPending: () => mockIsAuthBootstrapPending(),
  restoreAuthBootstrapReturnTo: () => mockRestoreAuthBootstrapReturnTo(),
}));

vi.mock('@/services/auth/authLogoutState', () => ({
  clearRecentManualLogout: () => mockClearRecentManualLogout(),
  hasRecentManualLogout: () => mockHasRecentManualLogout(),
  markRecentManualLogout: vi.fn(),
}));

vi.mock('@/services/auth/authFallback', () => ({
  hasActiveFirebaseSession: () => mockHasActiveFirebaseSession(),
}));

vi.mock('@/application/ports/auditPort', () => ({
  defaultAuditPort: {
    logUserLogin: (...args: unknown[]) => mockLogUserLogin(...args),
    logUserLogout: vi.fn(),
  },
}));

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalOutcome: (...args: unknown[]) => mockRecordOperationalOutcome(...args),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: (...args: unknown[]) => mockRecordOperationalTelemetry(...args),
}));

type ResolvedAuthBootstrapOptions = Parameters<typeof useResolvedAuthBootstrap>[0];

type RenderResolvedAuthBootstrapOptions = Omit<
  ResolvedAuthBootstrapOptions,
  'e2eBootstrapUser' | 'setSessionState' | 'setAuthLoading'
> & {
  e2eBootstrapUser?: ResolvedAuthBootstrapOptions['e2eBootstrapUser'];
  initialSessionState?: AuthSessionState;
  initialAuthLoading?: boolean;
  wrapper?: ComponentType<PropsWithChildren>;
};

export const authBootstrapTestMocks = {
  mockWarn,
  mockInfo,
  mockIsAuthBootstrapPending,
  mockGetAuthBootstrapPendingAgeMs,
  mockClearAuthBootstrapPending,
  mockRestoreAuthBootstrapReturnTo,
  mockClearRecentManualLogout,
  mockHasRecentManualLogout,
  mockHasActiveFirebaseSession,
  mockLogUserLogin,
  mockRecordOperationalOutcome,
  mockRecordOperationalTelemetry,
};

export const installResolvedAuthBootstrapTestLifecycle = (): void => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsAuthBootstrapPending.mockReturnValue(false);
    mockGetAuthBootstrapPendingAgeMs.mockReturnValue(0);
    mockHasRecentManualLogout.mockReturnValue(false);
    mockHasActiveFirebaseSession.mockReturnValue(false);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
};

export const flushBootstrapSetup = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
};

export const renderResolvedAuthBootstrap = ({
  e2eBootstrapUser = null,
  resolveRedirectAuthSessionOutcome,
  resolveCurrentAuthSessionOutcome,
  onAuthSessionStateChange,
  initialSessionState = {
    status: 'unauthenticated',
    user: null,
  },
  initialAuthLoading = true,
  wrapper,
}: RenderResolvedAuthBootstrapOptions) =>
  renderHook(
    () => {
      const [sessionState, setSessionState] = useState<AuthSessionState>(initialSessionState);
      const [authLoading, setAuthLoading] = useState(initialAuthLoading);

      useResolvedAuthBootstrap({
        e2eBootstrapUser,
        resolveRedirectAuthSessionOutcome,
        resolveCurrentAuthSessionOutcome,
        onAuthSessionStateChange,
        setSessionState,
        setAuthLoading,
      });

      return { sessionState, authLoading };
    },
    { wrapper }
  );
