import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from '@/App';
import { AuthProvider } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { DemoModeProvider } from '@/context/DemoModeContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/config/queryClient';

// Mock useAuthState
const mockUseAuthState = vi.fn();
vi.mock('@/hooks/useAuthState', () => ({
    useAuthState: () => mockUseAuthState()
}));

// Unmock the global AuthContext mock for this integration test
vi.unmock('@/context/AuthContext');
vi.unmock('../../context/AuthContext');

// Mock UI Components to simplify
vi.mock('../../components/auth/LoginPage', () => ({
    LoginPage: ({ onLoginSuccess }: any) => (
        <button data-testid="login-btn" onClick={onLoginSuccess}>Login</button>
    )
}));

vi.mock('./setup', () => ({
    render: (ui: any) => render(ui)
}));

describe('Flicker-Free Login Flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock reload safely without breaking location
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                reload: vi.fn(),
                pathname: '/',
                search: ''
            },
            writable: true
        });
    });

    it('should transition smoothly without window.location.reload when login succeeds', async () => {
        // 1. Initial State: Not logged in
        mockUseAuthState.mockReturnValue({
            user: null,
            authLoading: false,
            error: null,
            role: 'viewer',
            isEditor: false,
            isViewer: true,
            isOfflineMode: false,
            isFirebaseConnected: false,
            handleLogout: vi.fn(),
            handleDownloadPassport: vi.fn(),
            canDownloadPassport: false
        });

        const { rerender } = render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <UIProvider>
                        <DemoModeProvider>
                            <App />
                        </DemoModeProvider>
                    </UIProvider>
                </AuthProvider>
            </QueryClientProvider>
        );

        const loginBtn = screen.getByTestId('login-btn');
        expect(loginBtn).toBeDefined();

        // 2. Simulate Login Click
        act(() => {
            loginBtn.click();
        });

        // 3. Verify window.location.reload WAS NOT called
        expect(window.location.reload).not.toHaveBeenCalled();

        // 4. Simulate State change (the actual user coming back from Firebase)
        mockUseAuthState.mockReturnValue({
            user: { uid: 'user-123', email: 'test@hospital.cl' },
            authLoading: false,
            error: null,
            role: 'admin',
            isEditor: true,
            isViewer: false,
            isOfflineMode: false,
            isFirebaseConnected: true,
            handleLogout: vi.fn(),
            handleDownloadPassport: vi.fn(),
            canDownloadPassport: true
        });

        rerender(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <UIProvider>
                        <DemoModeProvider>
                            <App />
                        </DemoModeProvider>
                    </UIProvider>
                </AuthProvider>
            </QueryClientProvider>
        );

        // 5. Verify it moved past LoginPage (assuming AppInner or AppContent shows something else)
        expect(screen.queryByTestId('login-btn')).toBeNull();
    });
});
