import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import App from '@/App';

const mockUseAppBootstrapState = vi.fn();

vi.mock('@/app-shell/bootstrap/useAppBootstrapState', () => ({
  useAppBootstrapState: () => mockUseAppBootstrapState(),
}));

vi.mock('@/app-shell/runtime/AuthenticatedAppShell', () => ({
  AuthenticatedAppShell: () => <div data-testid="authenticated-shell">Authenticated Shell</div>,
}));

vi.mock('@/app-shell/bootstrap/BootstrapCensusChrome', () => ({
  BootstrapRouteChrome: () => (
    <div data-testid="bootstrap-route-chrome">Bootstrap Route Chrome</div>
  ),
}));

vi.mock('@/features/auth', () => ({
  LoginPage: () => <div data-testid="login-page">Login Page</div>,
}));

vi.mock('@/views/LazyViews', () => ({
  MedicalSignatureView: () => <div data-testid="signature-view">Signature View</div>,
}));

const createAuth = (
  sessionStatus: 'unauthenticated' | 'authorized' = 'unauthenticated',
  overrides: Record<string, unknown> = {}
) => ({
  authRuntime: {
    sessionStatus,
    authLoading: false,
    isFirebaseConnected: sessionStatus === 'authorized',
    isOnline: true,
    bootstrapPending: false,
    pendingAgeMs: 0,
    budgetProfile: 'default',
    timeoutMs: 15_000,
    runtimeState: 'ok',
    issues: [],
  },
  currentUser: sessionStatus === 'authorized' ? { uid: 'user-1' } : null,
  authorizedUser: sessionStatus === 'authorized' ? { uid: 'user-1' } : null,
  user: sessionStatus === 'authorized' ? { uid: 'user-1' } : null,
  role: sessionStatus === 'authorized' ? 'admin' : 'viewer',
  isLoading: false,
  isAuthenticated: sessionStatus === 'authorized',
  isAuthorizedSession: sessionStatus === 'authorized',
  isAnonymousSignature: false,
  isUnauthorized: false,
  isEditor: sessionStatus === 'authorized',
  isViewer: sessionStatus !== 'authorized',
  isFirebaseConnected: sessionStatus === 'authorized',
  remoteSyncStatus: sessionStatus === 'authorized' ? 'ready' : 'local_only',
  remoteSyncState:
    sessionStatus === 'authorized'
      ? { mode: 'enabled', reason: 'ready' }
      : { mode: 'local_only', reason: 'auth_unavailable' },
  signOut: vi.fn(),
  sessionState: {
    status: sessionStatus,
    user: sessionStatus === 'authorized' ? { uid: 'user-1' } : null,
  },
  ...overrides,
});

describe('App loading behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.sessionStorage.clear();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: '/',
        search: '',
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the login shell (never the legacy spinner) on the root route while bootstrap is loading', () => {
    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'bootstrapping',
      auth: createAuth('unauthenticated'),
    });

    render(<App />);

    expect(screen.getByTestId('login-loading-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
  });

  it('avoids the login loading shell while a same-tab authenticated refresh is still bootstrapping', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');

    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'rehydrating',
      auth: createAuth('unauthenticated'),
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('silent-bootstrap-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
  });

  it('keeps login hidden during a same tab authenticated refresh while bootstrap remains pending', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/census',
        search: '',
      },
      writable: true,
    });

    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'rehydrating',
      auth: createAuth('unauthenticated', {
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
      }),
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('does not suppress the real login page on the root route after a stale same-tab hint', async () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');

    mockUseAppBootstrapState.mockReturnValue({
      status: 'unauthenticated',
      auth: createAuth('unauthenticated'),
    });

    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
  });

  it('avoids the login loading shell while an authenticated session is still rehydrating on the root route', () => {
    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'rehydrating',
      auth: {
        sessionState: {
          status: 'authenticating',
          user: null,
        },
      },
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
  });

  it('keeps root-route bootstrapping visually silent once auth is already known', () => {
    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'bootstrapping',
      auth: createAuth('authorized'),
    });

    render(<App />);

    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('skips the initial loading screen while bootstrap is loading on the census route', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/census',
        search: '',
      },
      writable: true,
    });

    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'rehydrating',
      auth: createAuth('authorized'),
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('stays visually silent on the census route while a same-tab refresh is still loading', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/census',
        search: '',
      },
      writable: true,
    });

    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'rehydrating',
      auth: createAuth('unauthenticated'),
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('keeps the origin route chrome on other authenticated module refreshes too', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/nursing-handoff',
        search: '',
      },
      writable: true,
    });

    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'rehydrating',
      auth: createAuth('authorized'),
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('keeps the origin route chrome on authenticated module refreshes during bootstrapping', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/medical-handoff',
        search: '',
      },
      writable: true,
    });

    mockUseAppBootstrapState.mockReturnValue({
      status: 'loading',
      phase: 'bootstrapping',
      auth: createAuth('authorized'),
    });

    render(<App />);

    expect(screen.getByTestId('bootstrap-route-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('default-loading-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('renders the authenticated shell once bootstrap is authenticated', async () => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/census',
        search: '',
      },
      writable: true,
    });

    mockUseAppBootstrapState.mockReturnValue({
      status: 'authenticated',
      phase: 'authenticated',
      auth: createAuth('authorized'),
      dateNav: {
        selectedYear: 2026,
        setSelectedYear: vi.fn(),
        selectedMonth: 3,
        setSelectedMonth: vi.fn(),
        selectedDay: 18,
        setSelectedDay: vi.fn(),
        daysInMonth: 30,
        currentDateString: '2026-04-18',
        navigateDays: vi.fn(),
        isSignatureMode: false,
      },
    });

    render(<App />);

    expect(await screen.findByTestId('authenticated-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
  });

  it('renders the signature view when bootstrap enters signature mode', () => {
    mockUseAppBootstrapState.mockReturnValue({
      status: 'signature_mode',
      phase: 'signature_mode',
      auth: createAuth('authorized'),
    });

    render(<App />);

    expect(screen.getByTestId('signature-view')).toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });
});
