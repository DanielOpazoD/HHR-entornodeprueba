import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

type LazyBypassProps = Record<string, unknown>;

// Shared state accessible from both vi.mock factory and test code.
const { _lazyPending, _lazyResolved } = vi.hoisted(() => ({
  _lazyPending: [] as Promise<void>[],
  _lazyResolved: new Map<symbol, React.ComponentType<LazyBypassProps>>(),
}));

// Bypass React.lazy so lazy-loaded components render synchronously in tests.
vi.mock('@/utils/lazyWithRetry', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    lazyWithRetry: (factory: () => Promise<{ default: React.ComponentType<LazyBypassProps> }>) => {
      const key = Symbol();
      const p = factory().then((m: { default: React.ComponentType<LazyBypassProps> }) => {
        _lazyResolved.set(key, m.default);
      });
      _lazyPending.push(p);
      return React.forwardRef(function LazyBypass(
        props: LazyBypassProps,
        ref: React.ForwardedRef<unknown>
      ) {
        const Comp = _lazyResolved.get(key) ?? null;
        return Comp ? React.createElement(Comp, { ...props, ref }) : null;
      });
    },
  };
});

import { AppContent } from '@/components/layout/AppContent';
import { useCensusContext } from '@/context/CensusContext';
import { useAuth } from '@/context/AuthContext';
import { useExportManager } from '@/hooks/useExportManager';

export const mockDateStrip = vi.fn();
export const mockNavbar = vi.fn();

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: (props: unknown) => {
    mockNavbar(props);
    return <div data-testid="navbar">Navbar</div>;
  },
}));

vi.mock('@/components/layout/DateStrip', () => ({
  DateStrip: (props: unknown) => {
    mockDateStrip(props);
    return <div data-testid="datestrip">DateStrip</div>;
  },
}));

vi.mock('@/components/debug/TestAgent', () => ({
  TestAgent: () => <div data-testid="test-agent">TestAgent</div>,
}));

vi.mock('@/components/shared/SyncWatcher', () => ({
  SyncWatcher: () => <div data-testid="sync-watcher">SyncWatcher</div>,
}));

vi.mock('@/components/bookmarks/BookmarkBar', () => ({
  BookmarkBar: () => <div data-testid="bookmark-bar">BookmarkBar</div>,
}));

vi.mock('@/components/layout/StorageStatusBadge', () => ({
  default: () => <div data-testid="storage-badge">StorageStatusBadge</div>,
}));

vi.mock('@/components/security/PinLockScreen', () => ({
  PinLockScreen: () => <div data-testid="pin-lock">PinLockScreen</div>,
}));

vi.mock('@/components/AppRouter', () => ({
  AppRouter: () => <div data-testid="app-router">AppRouter</div>,
}));

vi.mock('@/components/AppProviders', () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-providers">{children}</div>
  ),
}));

vi.mock('@/context/ReminderCenterContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ReminderCenterProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'reminder-provider' }, children),
  };
});

vi.mock('@/components/layout/app-content/reminderCenterProviderLoader', () => {
  return {
    loadReminderCenterProvider: () => new Promise(() => {}),
  };
});

vi.mock('@/hooks/useReminders', () => ({
  useReminderCenter: () => ({
    isOpen: false,
    unreadCount: 0,
    hasUrgentUnread: false,
    loading: false,
    openCenter: vi.fn(),
    closeCenter: vi.fn(),
  }),
}));

vi.mock('@/views/LazyViews', () => ({
  CensusEmailConfigModal: () => <div data-testid="email-modal">EmailModal</div>,
}));

vi.mock('@/features/census/public-components', () => ({
  GlobalPatientSearchModal: () => <div data-testid="patient-search-modal">PatientSearchModal</div>,
  CensusView: () => <div data-testid="census-view">CensusView</div>,
  CensusEmailConfigModal: () => <div data-testid="email-modal">EmailModal</div>,
}));

vi.mock('@/components/reminders/ReminderModal', () => ({
  ReminderModal: () => <div data-testid="reminder-modal">ReminderModal</div>,
}));

vi.mock('@/context/CensusContext', () => ({
  useCensusContext: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('@/hooks/useExportManager', () => ({
  useExportManager: vi.fn(),
}));

// Flush lazy component resolutions before any test renders.
beforeAll(() => Promise.all(_lazyPending));

describe('AppContent', () => {
  type AppContentUi = React.ComponentProps<typeof AppContent>['ui'];
  type CensusContextValue = ReturnType<typeof useCensusContext>;
  type AuthValue = ReturnType<typeof useAuth>;
  type ExportManagerValue = ReturnType<typeof useExportManager>;

  const createModalMock = () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  });

  const mockUI = {
    currentModule: 'CENSUS' as const,
    setCurrentModule: vi.fn(),
    censusViewMode: 'REGISTER' as const,
    setCensusViewMode: vi.fn(),
    bedManagerModal: createModalMock(),
    settingsModal: createModalMock(),
    patientSearchModal: createModalMock(),
    showPrintButton: true,
    showBookmarksBar: true,
    setShowBookmarksBar: vi.fn(),
    isTestAgentRunning: false,
    setIsTestAgentRunning: vi.fn(),
    selectedShift: 'day' as const,
    setSelectedShift: vi.fn(),
  } as unknown as AppContentUi;

  const mockCensusContext = {
    dailyRecord: { record: {}, syncStatus: 'idle', lastSyncTime: null },
    dateNav: {
      isSignatureMode: false,
      currentDateString: '2024-01-01',
      selectedYear: 2024,
      selectedMonth: 1,
      selectedDay: 1,
      setSelectedYear: vi.fn(),
      setSelectedMonth: vi.fn(),
      setSelectedDay: vi.fn(),
      daysInMonth: 31,
      existingDaysInMonth: [],
      navigateDays: vi.fn(),
    },
    censusEmail: {
      showEmailConfig: false,
      setShowEmailConfig: vi.fn(),
      sendEmail: vi.fn(),
      status: 'idle',
      error: null,
      recipients: [],
      setRecipients: vi.fn(),
      message: '',
      onMessageChange: vi.fn(),
      onResetMessage: vi.fn(),
      isAdminUser: true,
      testModeEnabled: false,
      setTestModeEnabled: vi.fn(),
      testRecipient: '',
      setTestRecipient: vi.fn(),
    },
    fileOps: { handleExportCSV: vi.fn(), handleImportJSON: vi.fn() },
    nurseSignature: {},
  };

  const mockAuth = {
    currentUser: { email: 'test@test.com' },
    user: { email: 'test@test.com' },
    role: 'admin',
    signOut: vi.fn(),
    isFirebaseConnected: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCensusContext).mockReturnValue(mockCensusContext as unknown as CensusContextValue);
    vi.mocked(useAuth).mockReturnValue(mockAuth as unknown as AuthValue);
    vi.mocked(useExportManager).mockReturnValue({
      handleExportPDF: vi.fn(),
      handleBackupExcel: vi.fn(),
      handleBackupHandoff: vi.fn(),
      isArchived: false,
      isBackingUp: false,
    } as unknown as ExportManagerValue);
  });

  it('renders basic layout in normal mode', () => {
    render(<AppContent ui={mockUI} />);

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('datestrip')).toBeInTheDocument();
    expect(screen.getByTestId('bookmark-bar')).toBeInTheDocument();
    expect(screen.getByTestId('app-router')).toBeInTheDocument();
    expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('reminder-modal')).not.toBeInTheDocument();
  });

  it('hides Navbar and DateStrip in signature mode', () => {
    const signatureContext = {
      ...mockCensusContext,
      dateNav: { ...mockCensusContext.dateNav, isSignatureMode: true },
    };
    vi.mocked(useCensusContext).mockReturnValue(signatureContext as unknown as CensusContextValue);

    render(<AppContent ui={mockUI} />);

    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
  });

  it('hides DateStrip in the standalone statistics module', () => {
    render(
      <AppContent
        ui={{
          ...mockUI,
          currentModule: 'ANALYTICS' as unknown as AppContentUi['currentModule'],
        }}
      />
    );
    expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
  });

  it('hides BookmarkBar for non-privileged roles', () => {
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuth,
      role: 'doctor_urgency',
    } as unknown as AuthValue);
    render(<AppContent ui={mockUI} />);
    expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
  });

  it('hides BookmarkBar when disabled in UI state', () => {
    render(<AppContent ui={{ ...mockUI, showBookmarksBar: false }} />);
    expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
  });

  it('passes specialist census accessProfile to DateStrip', () => {
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuth,
      role: 'doctor_specialist',
    } as unknown as AuthValue);

    render(
      <AppContent
        ui={{
          ...mockUI,
          currentModule: 'CENSUS',
        }}
      />
    );

    expect(mockDateStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        accessProfile: 'specialist',
      })
    );
  });

  it('does not allow doctor_specialist to trigger archive verification checks on census entry', () => {
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuth,
      role: 'doctor_specialist',
    } as unknown as AuthValue);

    render(<AppContent ui={{ ...mockUI, currentModule: 'CENSUS' }} />);

    expect(useExportManager).toHaveBeenCalledWith(
      expect.objectContaining({
        canVerifyArchiveStatus: false,
      })
    );
  });

  it('sanitizes invalid persisted modules for doctor_specialist', () => {
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuth,
      role: 'doctor_specialist',
    } as unknown as AuthValue);

    render(
      <AppContent
        ui={{
          ...mockUI,
          currentModule: 'AUDIT' as unknown as AppContentUi['currentModule'],
        }}
      />
    );

    expect(mockUI.setCurrentModule).toHaveBeenCalledWith('CENSUS');
  });

  it('hides DateStrip for non-clinical modules', () => {
    render(<AppContent ui={{ ...mockUI, currentModule: 'DIAGNOSTICS' }} />);
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
      handleBackupHandoff: vi.fn(),
      isArchived: false,
      isBackingUp: false,
    };
    vi.mocked(useExportManager).mockReturnValue(mockExportManager as unknown as ExportManagerValue);

    const { unmount } = render(<AppContent ui={{ ...mockUI, currentModule: 'CENSUS' }} />);
    expect(mockDateStrip).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onOpenBedManager: expect.any(Function),
        onExportExcel: expect.any(Function),
        onConfigureEmail: expect.any(Function),
      })
    );
    unmount();

    render(<AppContent ui={{ ...mockUI, currentModule: 'CUDYR' }} />);
    expect(mockDateStrip).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onOpenBedManager: undefined,
        onExportExcel: undefined,
        onConfigureEmail: undefined,
      })
    );
  });

  it('shows and hides global modals/panels based on UI state', async () => {
    const uiWithModals = {
      ...mockUI,
      isTestAgentRunning: true,
    };

    const { rerender } = render(<AppContent ui={uiWithModals as unknown as AppContentUi} />);
    await act(async () => {
      await Promise.all(_lazyPending);
    });
    rerender(<AppContent ui={uiWithModals as unknown as AppContentUi} />);
    await act(async () => {
      await Promise.all(_lazyPending);
    });
    rerender(<AppContent ui={uiWithModals as unknown as AppContentUi} />);

    expect(screen.queryByTestId('reminder-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('test-agent')).toBeInTheDocument();
    expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    expect(screen.getByTestId('pin-lock')).toBeInTheDocument();
  });

  it('keeps SyncWatcher mounted in the main application shell', async () => {
    render(<AppContent ui={mockUI} />);
    await act(async () => {
      await Promise.all(_lazyPending);
    });

    expect(screen.getByTestId('sync-watcher')).toBeInTheDocument();
  });
});
