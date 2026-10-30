import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from '@/App';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';

// Mock useAuthState
const mockUseAuthState = vi.fn();
vi.mock('@/hooks/useAuthState', () => ({
  useAuthState: () => mockUseAuthState(),
}));

// Unmock the global AuthContext mock for this integration test
vi.unmock('@/context/AuthContext');
vi.unmock('../../context/AuthContext');

vi.mock('@/features/auth/components/LoginPage', () => ({
  LoginPage: ({ onLoginSuccess }: { onLoginSuccess: () => void }) => (
    <button data-testid="login-btn" onClick={onLoginSuccess}>
      Login
    </button>
  ),
}));

vi.mock('./setup', () => ({
  render: (ui: ReactNode) => render(ui),
}));

describe('Flicker-Free Login Flow', () => {
  const createAuthState = (overrides: Partial<ReturnType<typeof mockUseAuthState>> = {}) => {
    const currentUser = (overrides.currentUser ?? null) as AuthUser | null;
    const sessionState =
      overrides.sessionState ??
      ((currentUser
        ? {
            status: 'authorized',
            user: currentUser,
          }
        : {
            status: 'unauthenticated',
            user: null,
          }) as AuthSessionState);

    return {
      sessionState,
      currentUser,
      authorizedUser: sessionState.status === 'authorized' && currentUser ? currentUser : null,
      user: currentUser,
      authLoading: false,
      isFirebaseConnected: !!currentUser,
      handleLogout: vi.fn(),
      role: currentUser?.role || 'viewer',
      isEditor: currentUser?.role === 'admin' || currentUser?.role === 'editor',
      isViewer: !(currentUser?.role === 'admin' || currentUser?.role === 'editor'),
      canEdit: currentUser?.role === 'admin' || currentUser?.role === 'editor',
      ...overrides,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // Mock reload safely without breaking location
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: vi.fn(),
        pathname: '/',
        search: '',
      },
      writable: true,
    });
  });

  it.each([
    ['unauthenticated', { status: 'unauthenticated', user: null }],
    [
      'auth_error',
      { status: 'auth_error', user: null, error: { message: 'Validación sintética fallida' } },
    ],
    [
      'unauthorized',
      { status: 'unauthorized', user: null, reason: 'Acceso sintético no autorizado' },
    ],
  ] satisfies [string, AuthSessionState][])(
    'restores credential entry if session resolution ends in %s',
    async (_status, sessionState) => {
      mockUseAuthState.mockReturnValue(createAuthState());
      const { rerender } = render(<App />);
      act(() => screen.getByTestId('login-btn').click());
      expect(
        within(screen.getByTestId('login-loading-shell')).getByRole('status')
      ).toHaveTextContent('Validando tu acceso');

      mockUseAuthState.mockReturnValue(createAuthState({ sessionState }));
      await act(async () => rerender(<App />));

      expect(screen.getByTestId('login-btn')).toBeVisible();
      expect(screen.queryByText('Validando tu acceso…')).not.toBeInTheDocument();
    }
  );

  it('should transition smoothly without window.location.reload when login succeeds', async () => {
    // 1. Initial State: Not logged in
    mockUseAuthState.mockReturnValue(
      createAuthState({
        currentUser: null,
        sessionState: { status: 'unauthenticated', user: null },
        role: 'viewer',
        isEditor: false,
        isViewer: true,
        isFirebaseConnected: false,
      })
    );

    const { rerender } = render(<App />);

    const loginBtn = screen.getByTestId('login-btn');
    expect(loginBtn).toBeDefined();

    // 2. Simulate Login Click
    act(() => {
      loginBtn.click();
    });

    expect(within(screen.getByTestId('login-loading-shell')).getByRole('status')).toHaveTextContent(
      'Validando tu acceso'
    );
    expect(screen.queryByTestId('login-btn')).not.toBeInTheDocument();

    // 3. Verify window.location.reload WAS NOT called
    expect(window.location.reload).not.toHaveBeenCalled();

    // 4. Simulate State change (the actual user coming back from Firebase)
    mockUseAuthState.mockReturnValue(
      createAuthState({
        currentUser: {
          uid: 'user-123',
          email: 'test@hospital.cl',
          displayName: 'Admin Test',
          role: 'admin',
        } as AuthUser,
        role: 'admin',
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
      })
    );

    await act(async () => {
      rerender(<App />);
    });

    // 5. Verify it moved past LoginPage (assuming AppInner or AppContent shows something else)
    await waitFor(() => {
      expect(screen.queryByTestId('login-btn')).toBeNull();
    });

    mockUseAuthState.mockReturnValue(createAuthState());
    await act(async () => rerender(<App />));
    expect(screen.getByTestId('login-btn')).toBeVisible();
  });
});
