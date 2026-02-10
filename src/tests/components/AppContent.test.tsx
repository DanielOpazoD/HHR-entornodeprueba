import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { AppContent } from '@/components/layout/AppContent';
import { useCensusContext } from '@/context/CensusContext';
import { useAuth } from '@/context/AuthContext';
import { useExportManager } from '@/hooks/useExportManager';

// Mock components with prop tracking
export const mockDateStrip = vi.fn();
export const mockNavbar = vi.fn();
export const mockSettingsModal = vi.fn();

vi.mock('@/components', () => ({
    Navbar: (props: any) => {
        mockNavbar(props);
        return <div data-testid="navbar">Navbar</div>;
    },
    DateStrip: (props: any) => {
        mockDateStrip(props);
        return <div data-testid="datestrip">DateStrip</div>;
    },
    SettingsModal: (props: any) => {
        mockSettingsModal(props);
        return <div data-testid="settings-modal">SettingsModal</div>;
    },
    TestAgent: () => <div data-testid="test-agent">TestAgent</div>,
    SyncWatcher: () => <div data-testid="sync-watcher">SyncWatcher</div>,
    DemoModePanel: () => <div data-testid="demo-mode-panel">DemoModePanel</div>,
    BookmarkBar: () => <div data-testid="bookmark-bar">BookmarkBar</div>,
    StorageStatusBadge: () => <div data-testid="storage-badge">StorageStatusBadge</div>,
    ModuleType: {} as any
}));

vi.mock('@/components/security/PinLockScreen', () => ({
    PinLockScreen: () => <div data-testid="pin-lock">PinLockScreen</div>
}));

vi.mock('@/components/AppRouter', () => ({
    AppRouter: () => <div data-testid="app-router">AppRouter</div>
}));

vi.mock('@/components/AppProviders', () => ({
    AppProviders: ({ children }: { children: React.ReactNode }) => <div data-testid="app-providers">{children}</div>
}));

vi.mock('@/features/census/components/CensusEmailConfigModal', () => ({
    CensusEmailConfigModal: () => <div data-testid="email-modal">EmailModal</div>
}));

// Mock hooks
vi.mock('@/context/CensusContext', () => ({
    useCensusContext: vi.fn()
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: vi.fn()
}));

vi.mock('@/hooks/useExportManager', () => ({
    useExportManager: vi.fn()
}));

describe('AppContent', () => {
    const mockUI = {
        currentModule: 'CENSUS' as const,
        setCurrentModule: vi.fn(),
        censusViewMode: 'REGISTER' as const,
        setCensusViewMode: vi.fn(),
        bedManagerModal: { isOpen: false, open: vi.fn(), close: vi.fn() },
        settingsModal: { isOpen: false, open: vi.fn(), close: vi.fn() },
        demoModal: { isOpen: false, open: vi.fn(), close: vi.fn() },
        showPrintButton: true,
        showBookmarksBar: true,
        setShowBookmarksBar: vi.fn(),
        isTestAgentRunning: false,
        setIsTestAgentRunning: vi.fn(),
        selectedShift: 'day' as const,
        setSelectedShift: vi.fn(),
        censusLocalViewMode: 'CARDS' as const,
        setCensusLocalViewMode: vi.fn()
    } as any;

    const mockCensusContext = {
        dailyRecord: { record: {}, syncStatus: 'idle', lastSyncTime: null },
        dateNav: { isSignatureMode: false, currentDateString: '2024-01-01', selectedYear: 2024, selectedMonth: 1, selectedDay: 1 },
        censusEmail: { showEmailConfig: false, setShowEmailConfig: vi.fn() },
        fileOps: { handleExportCSV: vi.fn(), handleImportJSON: vi.fn() },
        nurseSignature: {},
        sharedCensus: { isSharedCensusMode: false }
    };

    const mockAuth = {
        user: { email: 'test@test.com' },
        role: 'admin',
        signOut: vi.fn(),
        isFirebaseConnected: true,
        canDownloadPassport: true,
        handleDownloadPassport: vi.fn(),
        isOfflineMode: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCensusContext).mockReturnValue(mockCensusContext as any);
        vi.mocked(useAuth).mockReturnValue(mockAuth as any);
        vi.mocked(useExportManager).mockReturnValue({} as any);
    });

    it('renders basic layout in normal mode', () => {
        render(<AppContent ui={mockUI} />);

        expect(screen.getByTestId('navbar')).toBeInTheDocument();
        expect(screen.getByTestId('datestrip')).toBeInTheDocument();
        expect(screen.getByTestId('bookmark-bar')).toBeInTheDocument();
        expect(screen.getByTestId('app-router')).toBeInTheDocument();
        expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    });

    it('hides Navbar and DateStrip in signature mode', () => {
        const signatureContext = {
            ...mockCensusContext,
            dateNav: { ...mockCensusContext.dateNav, isSignatureMode: true }
        };
        vi.mocked(useCensusContext).mockReturnValue(signatureContext as any);

        render(<AppContent ui={mockUI} />);

        expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
    });

    it('hides DateStrip and BookmarkBar in shared census mode', () => {
        const sharedContext = {
            ...mockCensusContext,
            sharedCensus: { isSharedCensusMode: true }
        };
        vi.mocked(useCensusContext).mockReturnValue(sharedContext as any);

        render(<AppContent ui={mockUI} />);

        expect(screen.getByTestId('navbar')).toBeInTheDocument(); // Navbar still shown
        expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
    });

    it('hides DateStrip in analytics mode', () => {
        render(<AppContent ui={{ ...mockUI, censusViewMode: 'ANALYTICS' }} />);
        expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
    });

    it('hides BookmarkBar for non-privileged roles', () => {
        vi.mocked(useAuth).mockReturnValue({ ...mockAuth, role: 'doctor_urgency' } as any);
        render(<AppContent ui={mockUI} />);
        expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
    });

    it('hides BookmarkBar when disabled in UI state', () => {
        render(<AppContent ui={{ ...mockUI, showBookmarksBar: false }} />);
        expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
    });

    it('hides DateStrip for non-clinical modules', () => {
        render(<AppContent ui={{ ...mockUI, currentModule: 'AUDIT' }} />);
        expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
    });

    it('responds to navigate-module window event', () => {
        render(<AppContent ui={mockUI} />);

        act(() => {
            const event = new CustomEvent('navigate-module', { detail: 'CUDYR' });
            window.dispatchEvent(event);
        });

        expect(mockUI.setCurrentModule).toHaveBeenCalledWith('CUDYR');
    });

    it('responds to set-shift window event', () => {
        render(<AppContent ui={mockUI} />);

        act(() => {
            const event = new CustomEvent('set-shift', { detail: 'night' });
            window.dispatchEvent(event);
        });

        expect(mockUI.setSelectedShift).toHaveBeenCalledWith('night');
    });

    it('handles DateStrip clinical actions correctly', () => {
        const mockExportManager = {
            handleExportPDF: vi.fn(),
            handleBackupExcel: vi.fn(),
            isArchived: false,
            isBackingUp: false
        };
        vi.mocked(useExportManager).mockReturnValue(mockExportManager as any);

        // CENSUS module triggers specific actions
        const { unmount } = render(<AppContent ui={{ ...mockUI, currentModule: 'CENSUS' }} />);
        expect(mockDateStrip).toHaveBeenLastCalledWith(expect.objectContaining({
            onOpenBedManager: expect.any(Function),
            onExportExcel: expect.any(Function),
            onConfigureEmail: expect.any(Function)
        }));
        unmount();

        // CUDYR module has fewer actions on DateStrip
        render(<AppContent ui={{ ...mockUI, currentModule: 'CUDYR' }} />);
        expect(mockDateStrip).toHaveBeenLastCalledWith(expect.objectContaining({
            onOpenBedManager: undefined,
            onExportExcel: undefined
        }));
    });

    it('shows and hides global modals/panels based on UI state', () => {
        const uiWithModals = {
            ...mockUI,
            settingsModal: { isOpen: true, close: vi.fn(), open: vi.fn() },
            demoModal: { isOpen: true, close: vi.fn(), open: vi.fn() },
            isTestAgentRunning: true
        };

        render(<AppContent ui={uiWithModals} />);

        expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
        expect(screen.getByTestId('test-agent')).toBeInTheDocument();
        expect(screen.getByTestId('demo-mode-panel')).toBeInTheDocument();
    });

    it('excludes SyncWatcher and DemoModePanel in shared mode', () => {
        const sharedContext = {
            ...mockCensusContext,
            sharedCensus: { isSharedCensusMode: true }
        };
        vi.mocked(useCensusContext).mockReturnValue(sharedContext as any);

        render(<AppContent ui={mockUI} />);

        expect(screen.queryByTestId('sync-watcher')).not.toBeInTheDocument();
        expect(screen.queryByTestId('demo-mode-panel')).not.toBeInTheDocument();
    });
});
