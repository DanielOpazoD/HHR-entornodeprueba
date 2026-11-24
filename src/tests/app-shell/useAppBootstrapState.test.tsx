import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextType } from '@/context';
import type { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import type { AuthUser } from '@/types/authRoleTypes';

const {
  mockUseAuth,
  mockUseDateNavigation,
  mockUseStorageMigration,
  mockUseVersionCheck,
  mockSetFirestoreSyncState,
  mockGetOptionalDb,
  mockRuntimeAdapter,
} = vi.hoisted(() => {
  const mockGetOptionalDb = vi.fn(() => null);
  return {
    mockUseAuth: vi.fn(),
    mockUseDateNavigation: vi.fn(),
    mockUseStorageMigration: vi.fn(),
    mockUseVersionCheck: vi.fn(),
    mockSetFirestoreSyncState: vi.fn(),
    mockGetOptionalDb,
    mockRuntimeAdapter: {
      getOptionalDb: () => mockGetOptionalDb(),
      readyFirestore: undefined as Promise<unknown> | undefined,
    },
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/useDateNavigation', () => ({
  useDateNavigation: () => mockUseDateNavigation(),
}));

vi.mock('@/app-shell/bootstrap/useVersionCheck', () => ({
  useVersionCheck: () => mockUseVersionCheck(),
}));

vi.mock('@/hooks/useStorageMigration', () => ({
  useStorageMigration: (...args: unknown[]) => mockUseStorageMigration(...args),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  setFirestoreSyncState: (...args: unknown[]) => mockSetFirestoreSyncState(...args),
}));

vi.mock('@/services/firebase-runtime/firebaseConfigRuntimeAdapter', () => ({
  defaultFirebaseConfigRuntimeAdapter: mockRuntimeAdapter,
}));

import {
  buildAppBootstrapState,
  useAppBootstrapState,
} from '@/app-shell/bootstrap/useAppBootstrapState';

const createAuthState = (overrides: Partial<AuthContextType> = {}): AuthContextType => {
  const remoteSyncStatus = (overrides.remoteSyncStatus || 'local_only') as
    | 'ready'
    | 'bootstrapping'
    | 'local_only';
  const remoteSyncState =
    overrides.remoteSyncState ||
    (remoteSyncStatus === 'ready'
      ? {
          mode: 'enabled',
          reason: 'ready',
        }
      : remoteSyncStatus === 'bootstrapping'
        ? {
            mode: 'bootstrapping',
            reason: 'auth_loading',
          }
        : {
            mode: 'local_only',
            reason: 'auth_unavailable',
          });

  return {
    sessionState: { status: 'unauthenticated', user: null },
    authRuntime: {
      sessionStatus: 'unauthenticated',
      authLoading: false,
      isFirebaseConnected: false,
      isOnline: true,
      bootstrapPending: false,
      pendingAgeMs: 0,
      budgetProfile: 'default',
      timeoutMs: 15_000,
      runtimeState: 'ok',
      issues: [],
    },
    currentUser: null,
    authorizedUser: null,
    role: 'viewer',
    isLoading: false,
    isAuthenticated: false,
    isAuthorizedSession: false,
    isAnonymousSignature: false,
    isUnauthorized: false,
    isEditor: false,
    isViewer: true,
    isFirebaseConnected: false,
    remoteSyncStatus,
    remoteSyncState,
    signOut: vi.fn(),
    ...overrides,
  };
};

const createDateNavigation = (
  overrides: Partial<UseDateNavigationReturn> = {}
): UseDateNavigationReturn => ({
  selectedYear: 2026,
  setSelectedYear: vi.fn(),
  selectedMonth: 2,
  setSelectedMonth: vi.fn(),
  selectedDay: 27,
  setSelectedDay: vi.fn(),
  daysInMonth: 31,
  currentDateString: '2026-03-27',
  navigateDays: vi.fn(),
  ...overrides,
});

describe('useAppBootstrapState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    mockGetOptionalDb.mockReturnValue(null);
    mockRuntimeAdapter.readyFirestore = undefined;
    mockUseAuth.mockReturnValue(createAuthState());
    mockUseDateNavigation.mockReturnValue(createDateNavigation());
  });

  it('returns loading while auth is resolving and keeps migration disabled', async () => {
    mockUseAuth.mockReturnValue(
      createAuthState({
        isLoading: true,
        isFirebaseConnected: true,
        remoteSyncStatus: 'bootstrapping',
      })
    );

    const { result } = renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(result.current.status).toBe('loading');
    expect(result.current.phase).toBe('rehydrating');
    expect(mockUseStorageMigration).toHaveBeenCalledWith({ enabled: false });
    expect(mockUseVersionCheck).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
        mode: 'bootstrapping',
        reason: 'auth_loading',
      });
    });
  });

  it('falls back to unauthenticated when the session has no active loading flag', async () => {
    mockUseAuth.mockReturnValue(
      createAuthState({
        sessionState: { status: 'authenticating', user: null },
        isLoading: false,
        isAuthenticated: false,
        isFirebaseConnected: false,
        remoteSyncStatus: 'bootstrapping',
      })
    );

    const { result } = renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(result.current.status).toBe('unauthenticated');
    await waitFor(() =>
      expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
        mode: 'bootstrapping',
        reason: 'auth_loading',
      })
    );
  });

  it('keeps a same-tab authenticated refresh in rehydrating while bootstrap is still pending', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    mockUseAuth.mockReturnValue(
      createAuthState({
        sessionState: { status: 'unauthenticated', user: null },
        isLoading: false,
        isAuthenticated: false,
        authRuntime: {
          sessionStatus: 'unauthenticated',
          authLoading: false,
          isFirebaseConnected: false,
          isOnline: true,
          bootstrapPending: true,
          pendingAgeMs: 1_200,
          budgetProfile: 'default',
          timeoutMs: 15_000,
          runtimeState: 'recoverable',
          issues: ['bootstrap pending'],
        },
      })
    );

    const { result } = renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(result.current.status).toBe('loading');
    expect(result.current.phase).toBe('rehydrating');
  });

  it('opens the normal sign-in gate for an old medical signature link', () => {
    window.history.replaceState(null, '', '/?mode=signature&date=27-03-2026&token=synthetic');
    try {
      const { result } = renderHook(() => useAppBootstrapState('2026-03-27'));

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.phase).toBe('local_only');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('returns unauthenticated when there is no active session', () => {
    const { result } = renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.phase).toBe('local_only');
    expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
      mode: 'local_only',
      reason: 'auth_unavailable',
    });
  });

  it('returns authenticated with the resolved app date navigation', () => {
    const currentUser: AuthUser = {
      uid: 'user-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    };
    mockUseAuth.mockReturnValue(
      createAuthState({
        currentUser,
        authorizedUser: currentUser,
        role: 'admin',
        isAuthenticated: true,
        isAuthorizedSession: true,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
        remoteSyncStatus: 'ready',
      })
    );
    mockUseDateNavigation.mockReturnValue(
      createDateNavigation({ currentDateString: '2026-03-31' })
    );
    mockGetOptionalDb.mockReturnValue({ name: 'db' } as never);

    const { result } = renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(result.current.status).toBe('authenticated');
    expect(result.current.phase).toBe('authenticated');
    if (result.current.status === 'authenticated') {
      expect(result.current.dateNav.currentDateString).toBe('2026-03-31');
    }
    expect(mockUseStorageMigration).toHaveBeenCalledWith({ enabled: true });
    expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
      mode: 'enabled',
      reason: 'ready',
    });
  });

  it('keeps Firestore disabled while an authenticated session reconnects Firebase', () => {
    const currentUser: AuthUser = {
      uid: 'user-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    };
    mockUseAuth.mockReturnValue(
      createAuthState({
        sessionState: { status: 'authorized', user: currentUser },
        currentUser,
        authorizedUser: currentUser,
        role: 'admin',
        isAuthenticated: true,
        isAuthorizedSession: true,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: false,
        remoteSyncStatus: 'bootstrapping',
      })
    );

    renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
      mode: 'bootstrapping',
      reason: 'auth_loading',
    });
  });

  it('keeps Firestore in bootstrapping until the runtime exposes db for an authenticated session', async () => {
    const currentUser: AuthUser = {
      uid: 'user-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    };
    mockUseAuth.mockReturnValue(
      createAuthState({
        currentUser,
        authorizedUser: currentUser,
        role: 'admin',
        isAuthenticated: true,
        isAuthorizedSession: true,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
        remoteSyncStatus: 'ready',
      })
    );

    renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
      mode: 'bootstrapping',
      reason: 'auth_connecting',
    });

    mockGetOptionalDb.mockReturnValue({ name: 'db' } as never);

    await waitFor(() =>
      expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
        mode: 'enabled',
        reason: 'ready',
      })
    );
  });

  it('reacts immediately to readyFirestore without polling intervals', async () => {
    let resolveFirestore!: () => void;
    mockRuntimeAdapter.readyFirestore = new Promise<void>(resolve => {
      resolveFirestore = resolve;
    });
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const currentUser: AuthUser = {
      uid: 'user-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    };
    mockUseAuth.mockReturnValue(
      createAuthState({
        currentUser,
        authorizedUser: currentUser,
        role: 'admin',
        isAuthenticated: true,
        isAuthorizedSession: true,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
        remoteSyncStatus: 'ready',
      })
    );

    renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
      mode: 'bootstrapping',
      reason: 'auth_connecting',
    });

    mockGetOptionalDb.mockReturnValue({ name: 'db' } as never);
    resolveFirestore();

    await waitFor(() =>
      expect(mockSetFirestoreSyncState).toHaveBeenCalledWith({
        mode: 'enabled',
        reason: 'ready',
      })
    );
    setIntervalSpy.mockRestore();
  });

  it('does not poll Firestore while unauthenticated in local_only mode', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    renderHook(() => useAppBootstrapState('2026-03-27'));

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('buildAppBootstrapState returns authenticated navigation wiring when access is ready', () => {
    const currentUser: AuthUser = {
      uid: 'user-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    };
    const auth = createAuthState({
      currentUser,
      authorizedUser: currentUser,
      role: 'admin',
      isAuthenticated: true,
      isAuthorizedSession: true,
      isEditor: true,
      isViewer: false,
    });
    const dateNav = createDateNavigation({ currentDateString: '2026-03-31' });

    const result = buildAppBootstrapState({
      auth,
      dateNav,
    });

    expect(result.status).toBe('authenticated');
    expect(result.phase).toBe('authenticated');
    if (result.status === 'authenticated') {
      expect(result.dateNav.currentDateString).toBe('2026-03-31');
      expect(result.dateNav.selectedDay).toBe(27);
    }
  });

  it('buildAppBootstrapState exposes bootstrapping while auth still loads without a rehydrating session', () => {
    const auth = createAuthState({
      isLoading: true,
      sessionState: { status: 'unauthenticated', user: null },
      remoteSyncStatus: 'bootstrapping',
      remoteSyncState: {
        mode: 'bootstrapping',
        reason: 'auth_loading',
      },
    });
    const dateNav = createDateNavigation();

    const result = buildAppBootstrapState({
      auth,
      dateNav,
    });

    expect(result.status).toBe('loading');
    expect(result.phase).toBe('bootstrapping');
    // The census day selection survives a session admission, so the header can keep showing it.
    expect(result.status === 'loading' && result.dateNav).toBe(dateNav);
  });
});
