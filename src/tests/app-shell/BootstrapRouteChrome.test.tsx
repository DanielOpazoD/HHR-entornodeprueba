import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { BootstrapRouteChrome } from '@/app-shell/bootstrap/BootstrapCensusChrome';
import { signOut as mockedAuthSessionSignOut } from '@/services/auth/authSession';
import { clearSessionScopedClientState } from '@/services/storage/sessionScopedStorageService';

const mockNavbar = vi.fn();
const mockDateStrip = vi.fn();

vi.mock('@/context/AuthContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return {
    ...actual,
  };
});

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: (props: Record<string, unknown>) => {
    mockNavbar(props);
    return <div data-testid="bootstrap-navbar">{String(props.currentModule)}</div>;
  },
}));

vi.mock('@/components/layout/DateStrip', () => ({
  DateStrip: (props: Record<string, unknown>) => {
    mockDateStrip(props);
    return <div data-testid="bootstrap-date-strip">{String(props.currentModule)}</div>;
  },
}));

vi.mock('@/components/ui/ViewLoader', () => ({
  ViewLoader: () => <div data-testid="view-loader">Loading</div>,
}));

vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn().mockResolvedValue(undefined),
}));

describe('BootstrapRouteChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders census chrome and preserves the route date when bootstrapping census', () => {
    window.history.replaceState({}, '', '/census?date=2026-04-22');

    render(<BootstrapRouteChrome />);

    expect(screen.getByTestId('bootstrap-navbar')).toHaveTextContent('CENSUS');
    expect(screen.getByTestId('bootstrap-date-strip')).toHaveTextContent('CENSUS');
    expect(mockNavbar).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        hideRuntimeIndicators: true,
      })
    );
    expect(mockDateStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'CENSUS',
        selectedYear: 2026,
        selectedMonth: 3,
        selectedDay: 22,
      })
    );
    expect(screen.queryByTestId('census-operational-state-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-loader')).not.toBeInTheDocument();
  });

  it('renders the nursing handoff chrome for nursing-handoff refreshes', () => {
    window.history.replaceState({}, '', '/nursing-handoff');

    render(<BootstrapRouteChrome />);

    expect(screen.getByTestId('bootstrap-navbar')).toHaveTextContent('NURSING_HANDOFF');
    expect(screen.getByTestId('bootstrap-date-strip')).toHaveTextContent('NURSING_HANDOFF');
    expect(mockNavbar).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'NURSING_HANDOFF',
      })
    );
    expect(mockDateStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'NURSING_HANDOFF',
        onExportPDF: expect.any(Function),
      })
    );
    expect(screen.getByTestId('view-loader')).toBeInTheDocument();
  });

  it('performs a real manual logout from the bootstrap chrome navbar', async () => {
    window.history.replaceState({}, '', '/census');
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    window.localStorage.setItem('firebase:authUser:demo-key', JSON.stringify({ uid: 'user-1' }));

    const replaceMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: '/census',
        search: '',
        hash: '',
        replace: replaceMock,
      },
    });

    try {
      render(<BootstrapRouteChrome />);

      const navbarProps = mockNavbar.mock.calls[0][0] as { onLogout: () => void };
      act(() => {
        navbarProps.onLogout();
      });

      // Immediate visual feedback while the sign-out settles.
      expect(screen.getByTestId('bootstrap-logout-overlay')).toHaveTextContent('Cerrando sesión');

      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
      expect(mockedAuthSessionSignOut).toHaveBeenCalled();
      expect(clearSessionScopedClientState).toHaveBeenCalledWith('manual');
      expect(window.sessionStorage.getItem('hhr_recent_manual_logout_v1')).not.toBeNull();
      expect(window.sessionStorage.getItem('hhr_logged_this_session')).toBeNull();
      expect(window.localStorage.getItem('firebase:authUser:demo-key')).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
